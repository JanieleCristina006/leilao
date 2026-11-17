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
process.env.BID_AUDIT_SECRET = 'test-only-audit-secret-with-at-least-32-bytes';
