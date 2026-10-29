import { IsEnum } from 'class-validator';
import { UserRole } from '../../../generated/prisma/enums.js';

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
