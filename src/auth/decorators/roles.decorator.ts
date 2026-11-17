import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '../../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), ApiBearerAuth());
