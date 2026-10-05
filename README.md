# AiTiMan Moni

AiTiMan Moni là ứng dụng quản lý chi tiêu cá nhân mobile-first, viết bằng Expo/React Native. App ưu tiên dùng được khi offline: SQLite là nguồn dữ liệu thao tác chính trên máy, còn Firebase/Firestore, Google Sheets và AI là các lớp tích hợp tùy chọn.

## Tính năng chính

- Tổng quan tháng: tổng chi, thu nhập, dòng tiền, ngân sách, xu hướng chi theo ngày, hạng mục chi nhiều nhất và giao dịch gần đây.
- Giao dịch: thêm/sửa/xóa chi tiêu, thu nhập, chuyển khoản nội bộ; tìm kiếm, lọc, phân trang và xem chi tiết giao dịch.
- Tài khoản/ví: nhiều tài khoản, số dư tính từ số dư đầu kỳ, ledger giao dịch và khoản điều chỉnh đối soát.
- Hũ chi tiêu: ngân sách tổng và ngân sách theo hạng mục, ngưỡng cảnh báo/giới hạn tùy chỉnh, cảnh báo khi gần hoặc vượt hũ.
- Smart Inbox: nhận diện thông báo ngân hàng trên Android, đưa giao dịch vào hộp chờ để người dùng kiểm tra trước khi xác nhận.
- Giao dịch định kỳ: daily/weekly/monthly/yearly, chế độ tự động hoặc chỉ nhắc, chống tạo trùng bằng occurrence key.
- Quy tắc phân loại: ưu tiên rule local trước AI để gợi ý hạng mục ổn định hơn.
- Thống kê: xem theo ngày/tuần/tháng/năm, pie chart hạng mục, danh sách hạng mục và drill-down giao dịch trong từng hạng mục.
- Đồng bộ đám mây: Firebase Authentication + Firestore, outbox local, soft delete, cursor incremental và kiểm tra quyền owner.
- Google Sheets: nhập/đồng bộ dữ liệu qua OAuth client ID cấu hình trong source local.
- AI: phân tích text/voice, gợi ý insight chi tiêu và phân tích sâu theo từng hũ. API key được cấu hình trong codebase local trước khi build.

## Yêu cầu

- Node.js và npm.
- Expo SDK 57 (`expo ~57.0.26`).
- JDK/Android SDK nếu build Android local.
- Firebase project đã bật Authentication và Firestore nếu dùng đồng bộ.
- Các file cấu hình local/key ở phần bên dưới.

## Cài đặt sau khi lấy source

```bash
npm install
```

Tạo các file local từ file mẫu:

```powershell
copy src\config\ai.local.example.ts src\config\ai.local.ts
copy src\config\firebase.local.example.ts src\config\firebase.local.ts
copy src\config\google.local.example.ts src\config\google.local.ts
```

Sau đó điền các giá trị thật:

- `src/config/ai.local.ts`: `aiApiKey` cho ShopAIKey/OpenAI-compatible endpoint. Key này được bundle vào bản build, không nhập trên máy Android.
- `src/config/firebase.local.ts`: `webClientId` của Firebase Authentication, dùng cho Google Sign-In. Đây là Web client ID, không phải Android client ID.
- `src/config/google.local.ts`: `androidClientId` và `iosClientId` cho Google Sheets OAuth. Không điền client secret vào app.
- `google-services.json`: tải từ Firebase console và đặt ở thư mục gốc project.
- `.env`: hiện chỉ có `.env.example` để ghi chú; không đặt AI key ở đây.

Các file local/key trên đã nằm trong `.gitignore`, không commit lên Git.

## Chạy app

```bash
npm run start
```

App dùng SQLite, Firebase native, audio/camera, notification listener và các module native khác, vì vậy Expo Go không đủ cho toàn bộ tính năng. Dùng development build hoặc APK local khi kiểm thử trên Android thật.

## Build Android

Nếu dùng native Android project đã generate trên máy:

```powershell
cd android
.\gradlew.bat assembleRelease
```

APK release nằm tại:

```text
android/app/build/outputs/apk/release/
```

Không commit keystore, service-account key, `google-services.json` thật hoặc file local key.

## Kiểm tra chất lượng

```bash
npm test
npm run lint
npm run typecheck
npx expo-doctor
```

Theo quy ước project, trước khi hoàn tất thay đổi nên chạy lint và typecheck.

## Đồng bộ Firebase

1. Bật Email/Password và Google Sign-In trong Firebase Authentication.
2. Tải `google-services.json` cho Android app đúng package.
3. Điền `src/config/firebase.local.ts`.
4. Deploy `firestore.rules` và `firestore.indexes.json`.
5. Đăng nhập lại trong app nếu gặp lỗi permission-denied sau khi đổi project/rules.

Firestore chỉ là lớp đồng bộ. SQLite local vẫn là nguồn dữ liệu thao tác khi offline.

## Google Sheets

1. Tạo OAuth client ID cho Android/iOS trong Google Cloud.
2. Với Android, cấu hình đúng package name và SHA-1 của bản build.
3. Điền client ID vào `src/config/google.local.ts`.
4. Build lại app để `app.config.ts` gắn redirect scheme:

```text
com.googleusercontent.apps.<client-id>:/oauth2redirect
```

Không dùng client secret trong mobile app.

## AI và quyền riêng tư

AI key được đọc từ `src/config/ai.local.ts` qua `src/services/ai/secure-config.ts`. Sau khi đổi key cần build lại app để bản Android nhận cấu hình mới.

AI chỉ nhận dữ liệu cần thiết cho từng tác vụ:

- Parse giao dịch từ text/voice: gửi nội dung người dùng nhập hoặc bản ghi âm đã chuyển chữ.
- Insight chi tiêu: gửi dữ liệu tổng hợp như tổng chi, thu nhập, hạng mục top, số giao dịch và trạng thái hũ.
- Smart Inbox ngân hàng: giao dịch không chắc chắn được đưa vào hộp chờ để người dùng kiểm tra trước khi lưu.

Không đưa service-account key, client secret hoặc private key vào app mobile.

## File key cần backup riêng

Các file này cần cập nhật lại sau khi clone source mới:

```text
src/config/ai.local.ts
src/config/firebase.local.ts
src/config/google.local.ts
google-services.json
.env nếu môi trường riêng có dùng
```

Trong workspace này, bản backup zip local được tạo tại `local-secrets.zip`. File zip này bị Git ignore và chỉ dùng để chuyển riêng ngoài repository.

## Giới hạn hiện tại

- Ảnh hóa đơn vẫn lưu local; cloud storage/OCR chưa là luồng chính.
- Không có kết nối bank API trực tiếp; Android notification listener phụ thuộc quyền hệ thống và hành vi từng hãng máy.
- AI hỗ trợ phân tích/gợi ý, không tự xác nhận giao dịch và không thay người dùng quyết định tài chính.

Xem thêm [SECURITY.md](./SECURITY.md).
