// ข้อมูลการ์ดสมมติสำหรับเริ่มต้นระบบ ไม่ใช่รายการสินค้าจริง
export const categories = ['Pokémon', 'Yu-Gi-Oh!', 'One Piece', 'Magic: The Gathering'];
// Original sample artwork is local; listings are demonstration data, not inventory.
export const seedCards = [
  ['Ember Dragon EX', 'Pokémon', 'Obsidian collection · 006/165', 'SAR', 245000, 'fire'],
  ['Lunar Guardian', 'Pokémon', 'Moonlight collection · 197/190', 'AR', 89000, 'moon'],
  ['Ocean Captain', 'One Piece', 'Ocean adventure · OP01-001', 'SR', 165000, 'ocean'],
  ['Celestial Sorcerer', 'Yu-Gi-Oh!', 'Celestial legends · CL-008', 'UR', 72000, 'magic'],
  ['Forest Familiar', 'Magic: The Gathering', 'Enchanted woods · 024/280', 'Rare', 45000, 'forest'],
  ['Thunder Fox', 'Pokémon', 'Electric dreams · 025/165', 'SR', 128000, 'electric'],
  ['Crimson Voyager', 'One Piece', 'New horizons · OP02-013', 'SEC', 320000, 'fire'],
  ['Starlight Oracle', 'Yu-Gi-Oh!', 'Astral archive · AA-021', 'UR', 58000, 'moon']
].map(([name, category, set, rarity, price, art], i) => ({ id: `sample-${i + 1}`, name, category, set, rarity, price, condition: i === 4 ? 'Excellent' : 'Near Mint', image: `/art/${art}.svg`, sellerId: 'sample-merchant', sellerName: 'Cardspace Studio', createdAt: new Date(2026, 8, 20 - i).toISOString() }));
