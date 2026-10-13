// Numeric grades only; special label designations are not inferred from a score.
export const gradingCompanies = ['PSA', 'BGS', 'CGC'];
// คืนคะแนนที่รองรับของแต่ละบริษัท โดยไม่อนุมานฉลากพิเศษ
export function gradesFor(company) {
  return Array.from({ length: 19 }, (_, i) => String(1 + i / 2)).filter(g => company !== 'PSA' || g !== '9.5').reverse();
}
// จัดรูปข้อความบริษัทและคะแนน หรือ Raw สำหรับการ์ดไม่ส่งเกรด
export function gradeText(card) {
  return card.grading ? `${card.grading.company} ${card.grading.grade}` : 'ไม่ส่งเกรด';
}
