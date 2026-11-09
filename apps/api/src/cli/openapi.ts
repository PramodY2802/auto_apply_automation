/** Writes the OpenAPI document to docs/openapi.json without starting a server. */
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../bootstrap';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function main() {
  const app = await createApp();
  await app.init();
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('AutoApply API').setVersion('1.0').addCookieAuth('aa_session').addBearerAuth().build());
  const out = path.resolve(__dirname, '../../../../docs/openapi.json');
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`Wrote ${out} (${Object.keys(doc.paths).length} paths)`);
  await app.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
