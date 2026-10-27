jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
}));

jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class MockAuthGuard {},
}));

jest.mock('@nestjs/mapped-types', () => ({
  PartialType: (base) => class PartialDto extends base {},
  OmitType: (base) => class OmittedDto extends base {},
}));
