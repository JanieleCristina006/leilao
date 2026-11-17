const { test } = require('node:test');
const assert = require('node:assert/strict');

test('OpenAPI describes positive prices, optional updates, bid counts and bearer auth', async () => {
  process.env.JWT_SECRET = 'contract-test-jwt-secret-with-at-least-32-bytes';
  process.env.BID_AUDIT_SECRET =
    'contract-test-audit-secret-with-at-least-32-bytes';
  const { Test } = require('@nestjs/testing');
  const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
  const { AppModule } = require('../dist/src/app/app.module.js');
  const { PrismaService } = require('../dist/src/prisma/prisma.service.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
  const app = module.createNestApplication();
  try {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    assert.ok(doc.paths['/lots']);
    assert.equal(
      doc.components.schemas.CreateLotDto.properties.startingBid.minimum,
      0.01,
    );
    assert.ok(
      !doc.components.schemas.UpdateLotDto.required?.includes('startingBid'),
    );
    assert.equal(
      doc.components.schemas.LotResponseDto.properties.bidCount.type,
      'number',
    );
    assert.ok(
      doc.paths['/bids'].post.security.some((security) => security.bearer),
    );
    assert.ok(!doc.paths['/lots'].get.security?.length);
  } finally {
    await app.close();
  }
});
