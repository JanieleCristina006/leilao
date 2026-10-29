import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { BidStatus, LotStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getAllowedFrontendOrigins } from '../common/frontend-origin.js';
import type { Server, Socket } from 'socket.io';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JwtPayload = { sub?: string };
type LiveSocket = Socket & { data: { userId?: string } };

@Injectable()
@WebSocketGateway({
  cors: {
    origin: getAllowedFrontendOrigins(),
  },
})
export class BidsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(BidsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const token = this.getToken(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      if (!payload.sub) {
        client.disconnect(true);
        return;
      }

      const profile = await this.prisma.profile.findUnique({
        where: { id: payload.sub },
        select: { id: true },
      });

      if (!profile) {
        client.disconnect(true);
        return;
      }

      const socket = client as LiveSocket;
      socket.data.userId = profile.id;
      await socket.join(this.userRoom(profile.id));
      socket.emit('live.ready');
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const socket = client as LiveSocket;
    if (socket.data.userId) {
      this.logger.debug(
        `Usuário ${socket.data.userId} desconectou da sala ao vivo.`,
      );
    }
  }

  @SubscribeMessage('lot.join')
  async joinLot(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { lotId?: unknown },
  ) {
    const socket = client as LiveSocket;
    const lotId = payload?.lotId;

    if (!socket.data.userId) {
      socket.emit('live.error', {
        message: 'A conexão ainda não foi autenticada.',
      });
      return;
    }

    if (typeof lotId !== 'string' || !UUID_PATTERN.test(lotId)) {
      socket.emit('live.error', {
        message: 'O identificador do lote é inválido.',
      });
      return;
    }

    const room = this.lotRoom(lotId);
    await socket.join(room);

    try {
      const snapshot = await this.getLotSnapshot(lotId, socket.data.userId);

      if (!snapshot) {
        await socket.leave(room);
        socket.emit('live.error', { message: 'Lote não encontrado.' });
        return;
      }

      socket.emit('lot.snapshot', snapshot);
    } catch (error) {
      await socket.leave(room);
      this.logger.error(
        'Não foi possível carregar o estado ao vivo do lote.',
        error,
      );
      socket.emit('live.error', {
        message: 'Não foi possível carregar a sala ao vivo. Tente novamente.',
      });
    }
  }

  @SubscribeMessage('lot.leave')
  async leaveLot(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { lotId?: unknown },
  ) {
    if (
      typeof payload?.lotId === 'string' &&
      UUID_PATTERN.test(payload.lotId)
    ) {
      await client.leave(this.lotRoom(payload.lotId));
    }
  }

  publishBidAccepted(event: {
    lotId: string;
    bidId: string;
    bidderId: string;
    bidderName: string;
    previousLeaderId: string | null;
    amount: string;
    createdAt: Date;
    endsAt: Date;
  }) {
    this.server.to(this.lotRoom(event.lotId)).emit('bid.updated', {
      lotId: event.lotId,
      currentBid: event.amount,
      bid: {
        id: event.bidId,
        amount: event.amount,
        createdAt: event.createdAt.toISOString(),
        bidderLabel: event.bidderName,
      },
      endsAt: event.endsAt.toISOString(),
    });

    if (event.previousLeaderId) {
      this.server
        .to(this.userRoom(event.previousLeaderId))
        .emit('leadership.updated', {
          lotId: event.lotId,
          isLeading: false,
        });
    }

    this.server.to(this.userRoom(event.bidderId)).emit('leadership.updated', {
      lotId: event.lotId,
      isLeading: true,
    });
  }

  publishLotClosed(event: {
    lotId: string;
    status: LotStatus;
    finalAmount: string;
    winnerId: string | null;
    closedAt: Date;
  }) {
    this.server.to(this.lotRoom(event.lotId)).emit('lot.closed', {
      lotId: event.lotId,
      status: event.status,
      finalAmount: event.finalAmount,
      closedAt: event.closedAt.toISOString(),
    });

    if (event.winnerId) {
      this.server.to(this.userRoom(event.winnerId)).emit('lot.result', {
        lotId: event.lotId,
        isWinner: true,
        finalAmount: event.finalAmount,
      });
    }
  }

  private async getLotSnapshot(lotId: string, userId: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        title: true,
        status: true,
        startingBid: true,
        minimumIncrement: true,
        currentBid: true,
        endsAt: true,
        auction: {
          select: { status: true, startsAt: true },
        },
      },
    });

    if (!lot) return null;

    const [history, leader] = await Promise.all([
      this.prisma.bid.findMany({
        where: { lotId, status: BidStatus.ACCEPTED },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          bidderId: true,
          amount: true,
          createdAt: true,
          bidder: { select: { name: true } },
        },
      }),
      this.prisma.bid.findFirst({
        where: { lotId, status: BidStatus.ACCEPTED },
        orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
        select: { bidderId: true },
      }),
    ]);

    return {
      lot: {
        id: lot.id,
        title: lot.title,
        status: lot.status,
        auctionStatus: lot.auction.status,
        startingBid: lot.startingBid.toFixed(2),
        minimumIncrement: lot.minimumIncrement.toFixed(2),
        currentBid: lot.currentBid?.toFixed(2) ?? null,
        startsAt: lot.auction.startsAt.toISOString(),
        endsAt: lot.endsAt.toISOString(),
      },
      history: history.map((bid) => ({
        id: bid.id,
        amount: bid.amount.toFixed(2),
        createdAt: bid.createdAt.toISOString(),
        bidderName: bid.bidder.name,
        isMine: bid.bidderId === userId,
      })),
      isLeading: leader?.bidderId === userId,
      serverTime: new Date().toISOString(),
    };
  }

  private getToken(client: Socket) {
    const authToken: unknown = client.handshake.auth?.token;
    const authorization = client.handshake.headers.authorization;
    const value =
      typeof authToken === 'string'
        ? authToken
        : typeof authorization === 'string'
          ? authorization
          : undefined;

    return value?.replace(/^Bearer\s+/i, '');
  }

  private lotRoom(lotId: string) {
    return `lot:${lotId}`;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }
}
