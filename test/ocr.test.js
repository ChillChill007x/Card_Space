import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardText } from '../server/card-ocr.js';

test('OCR only suggests visible label values; does not infer grade from HP or artwork', () => {
  const raw=parseCardText('POKEMON\nPIKACHU\nHP 100\n085/165');
  assert.equal(raw.name,'PIKACHU');
  assert.equal(raw.gradingGrade,undefined);
  assert.equal(raw.gradingCertificate,undefined);
  const slab=parseCardText('PSA\nNAME: PIKACHU\nSET: VAN GOGH PROMO\nGEM MINT 10\nCERT: 12345678');
  assert.equal(slab.gradingGrade,'10');
  assert.equal(slab.gradingCertificate,'12345678');
  assert.equal(parseCardText('PSA\nGRADE 9.5').gradingGrade,undefined);
  assert.equal(parseCardText('PSA\nHP 100\nDamage 10').gradingGrade,undefined);
  const cgc=parseCardText('CGC CERTIFIED GUARANTY COMPANY\nPikachu with Grey Felt Hat GEM MINT\n10\n6143010014');
  assert.equal(cgc.name,'Pikachu with Grey Felt Hat');
  assert.equal(cgc.gradingCertificate,'6143010014');
  assert.equal(parseCardText('PSA\nCHARIZARD —HOLO GEM MT\n10\n26573583').gradingGrade,'10');
});
