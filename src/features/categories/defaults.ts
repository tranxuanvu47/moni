import type { CategoryKind } from '@/src/types/finance';

export interface DefaultCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: CategoryKind;
  sortOrder: number;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { id: 'cat_food', name: 'Ăn uống', icon: 'utensils', color: '#183D32', type: 'expense', sortOrder: 1 },
  { id: 'cat_drink', name: 'Cà phê / Đồ uống', icon: 'coffee', color: '#4C8B70', type: 'expense', sortOrder: 2 },
  { id: 'cat_shopping', name: 'Mua sắm', icon: 'shopping-bag', color: '#8A6A4F', type: 'expense', sortOrder: 3 },
  { id: 'cat_transport', name: 'Di chuyển', icon: 'car', color: '#3E5C76', type: 'expense', sortOrder: 4 },
  { id: 'cat_housing', name: 'Nhà ở', icon: 'house', color: '#5C6B62', type: 'expense', sortOrder: 5 },
  { id: 'cat_bills', name: 'Hóa đơn', icon: 'receipt', color: '#6B5E4E', type: 'expense', sortOrder: 6 },
  { id: 'cat_fun', name: 'Giải trí', icon: 'clapperboard', color: '#7A5C6E', type: 'expense', sortOrder: 7 },
  { id: 'cat_health', name: 'Sức khỏe', icon: 'heart-pulse', color: '#C36C60', type: 'expense', sortOrder: 8 },
  { id: 'cat_edu', name: 'Giáo dục', icon: 'graduation-cap', color: '#3F6F62', type: 'expense', sortOrder: 9 },
  { id: 'cat_family', name: 'Gia đình', icon: 'users', color: '#5A6B4E', type: 'expense', sortOrder: 10 },
  { id: 'cat_other', name: 'Khác', icon: 'ellipsis', color: '#777F79', type: 'both', sortOrder: 11 },
  { id: 'cat_income', name: 'Thu nhập', icon: 'wallet', color: '#4C8B70', type: 'income', sortOrder: 12 },
];

export const OTHER_CATEGORY_ID = 'cat_other';
export const INCOME_CATEGORY_ID = 'cat_income';
export const FOOD_CATEGORY_ID = 'cat_food';

export const CATEGORY_KEYWORDS: { name: string; keywords: string[] }[] = [
  { name: 'Cà phê / Đồ uống', keywords: ['cà phê', 'cafe', 'coffee', 'trà sữa', 'trà', 'sinh tố', 'nước ngọt', 'đồ uống', 'matcha', 'bạc xỉu'] },
  { name: 'Di chuyển', keywords: ['đổ xăng', 'xăng', 'grab', 'taxi', 'xe ôm', 'xe buýt', 'gửi xe', 'đi làm', 'xanh sm', 'vé xe', 'tàu', 'máy bay'] },
  { name: 'Ăn uống', keywords: ['ăn sáng', 'ăn trưa', 'ăn tối', 'ăn', 'cơm', 'phở', 'bún', 'bánh mì', 'nhà hàng', 'đồ ăn', 'lẩu', 'nướng'] },
  { name: 'Mua sắm', keywords: ['siêu thị', 'shopee', 'lazada', 'quần áo', 'mua đồ', 'mua'] },
  { name: 'Nhà ở', keywords: ['thuê nhà', 'tiền nhà', 'tiền phòng', 'chung cư'] },
  { name: 'Hóa đơn', keywords: ['hóa đơn', 'tiền điện', 'tiền nước', 'internet', 'wifi', 'cước', 'điện thoại'] },
  { name: 'Giải trí', keywords: ['xem phim', 'phim', 'game', 'netflix', 'karaoke', 'spotify'] },
  { name: 'Sức khỏe', keywords: ['nhà thuốc', 'thuốc', 'bệnh viện', 'khám', 'gym'] },
  { name: 'Giáo dục', keywords: ['học phí', 'khóa học', 'sách', 'học'] },
  { name: 'Gia đình', keywords: ['gia đình', 'biếu', 'bố mẹ', 'cho con'] },
  { name: 'Thu nhập', keywords: ['lương', 'thưởng', 'thu nhập', 'được trả'] },
];
