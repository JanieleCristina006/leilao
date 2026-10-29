import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const passwordHash = await bcrypt.hash(createUserDto.password, 12);

      const createUser = await this.prisma.profile.create({
        data: {
          name: createUserDto.name,
          email: createUserDto.email,
          passwordHash: passwordHash,
          wallet: { create: {} },
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        message: 'Usuário criado com sucesso!',
        createUser,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAll() {
    return this.prisma.profile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.profile.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      const data: Prisma.ProfileUpdateInput = {};

      if (updateUserDto.name !== undefined) data.name = updateUserDto.name;
      if (updateUserDto.email !== undefined) data.email = updateUserDto.email;
      if (updateUserDto.password !== undefined) {
        data.passwordHash = await bcrypt.hash(updateUserDto.password, 12);
      }

      const updateUser = await this.prisma.profile.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        message: 'Usuário atualizado com sucesso!',
        updateUser,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateRole(id: string, updateUserRoleDto: UpdateUserRoleDto) {
    try {
      const updateUser = await this.prisma.profile.update({
        where: { id },
        data: { role: updateUserRoleDto.role },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        message: 'Papel do usuário atualizado com sucesso!',
        updateUser,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: string) {
    try {
      const removeUser = await this.prisma.profile.delete({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        message: 'Usuário removido com sucesso!',
        removeUser,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          throw new ConflictException('Já existe um usuário com esse e-mail.');
        case 'P2025':
          throw new NotFoundException('Usuário não encontrado.');
        case 'P2003':
        case 'P2014':
          throw new ConflictException(
            'Não é possível excluir este usuário porque existem dados vinculados a ele.',
          );
      }
    }

    throw error;
  }
}
