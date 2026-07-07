# TỔNG QUAN DỰ ÁN TELEDRIVE WEB

Dự án TeleDrive Web là một hệ thống lưu trữ tệp tin trên nền web (Cloud Storage) sử dụng chính tài khoản Telegram của người dùng làm máy chủ lưu trữ miễn phí và không giới hạn.

## Lịch sử Phát triển (Phases)

### Giai đoạn 1: Khởi tạo VFS (Virtual File System)
- [x] Tạo cấu trúc thư mục ảo sử dụng Hashtag `#teledrive` và JSON Metadata đính kèm trong Caption của tin nhắn.
- [x] Đăng nhập Telegram bằng QR Code / Số điện thoại thông qua GramJS.
- [x] Lưu trữ session bảo mật cục bộ (IndexedDB).

### Giai đoạn 2: Quản lý File Cơ bản
- [x] Tải file lên Telegram (Upload).
- [x] Tải file từ Telegram xuống máy tính (Download).
- [x] Xóa file (Delete messages).
- [x] Cấu trúc Breadcrumb điều hướng cơ bản.

### Giai đoạn 3: Trải nghiệm Xem trước (Preview Modal)
- [x] Xây dựng Cửa sổ Xem trước (Preview) cho Hình ảnh và Video trực tiếp trên nền web.
- [x] Sửa lỗi tải xuống tệp tin bị hỏng (Blob/ArrayBuffer).
- [x] Thêm định dạng Icon màu sắc phân biệt cho các loại file khác nhau (Image, Video, Word, PDF, Zip).

### Giai đoạn 4: Hỗ trợ tạo Thư mục ảo (Folders)
- [x] Code logic giả lập Thư mục: Tự động phân tích đường dẫn (`/A/B`) để vẽ ra các Thư mục rỗng hoặc chứa file.
- [x] Cho phép tạo Thư mục mới và điều hướng chui vào trong Thư mục.

### Giai đoạn 5: Tối ưu Tải lên & Gallery View
- [x] Chế độ chọn Tải lên nhiều file cùng lúc (Multi-upload).
- [x] Hàng đợi tải lên (Upload Queue) có thanh tiến trình % chống lỗi FloodWait.
- [x] Tích hợp Chế độ Xem Thư viện (Gallery View) tự động tải ảnh Thumbnail siêu nhẹ từ Telegram để hiển thị trên web.

### Giai đoạn 6: Quản lý Nâng cao & Giao diện Chuyên nghiệp
- [x] Tích hợp tính năng Chọn nhiều (Multi-select Checkbox).
- [x] Thao tác Xóa hàng loạt và Cảnh báo an toàn (Không cho xóa thư mục nếu đang có file).
- [x] Thao tác Di chuyển file (Move) siêu tốc bằng API Edit Message Caption của Telegram.
- [x] Loại bỏ hoàn toàn các hộp thoại thô sơ của trình duyệt và thay bằng hệ thống Custom Modals (React) mượt mà có hiệu ứng Blur.
- [x] Bổ sung nút Select All (Chọn tất cả) trên thanh công cụ.
- [x] Zero-delay View: Tích hợp Zoom ảnh (chuột và click đúp) cùng khả năng load trước Thumbnail làm nền trong lúc tải ảnh nét.

### Giai đoạn 7: Windows Explorer View
- [x] Xây dựng Menu "Tùy chọn hiển thị" (View Options).
- [x] Chế độ **Details** (Bảng chi tiết thông tin file).
- [x] Chế độ **List** (Danh sách siêu gọn).
- [x] Hệ thống Icon Grid 3 cấp độ: **Medium Icon**, **Large Icon**, **Extra Large Icon**.

### Giai đoạn 8: Đột phá Kiến trúc Google Photos
- [x] **Thanh Tìm Kiếm (Search Bar)**: Tìm kiếm tức thì trong ổ đĩa toàn cục.
- [x] **Cơ sở dữ liệu Cục bộ (Offline-First IndexedDB)**: Tích hợp Dexie.js làm DB Cache trên trình duyệt. Lần thứ 2 mở web sẽ load ngay lập tức hàng chục ngàn file trong 0.1 giây (Zero-delay load).
- [x] **Delta Sync**: Thuật toán đồng bộ hóa thông minh, chỉ chạy ngầm hỏi Telegram lấy danh sách các file MỚI và trộn vào DB cục bộ.
- [x] **Tab "Photos" & Giao diện Dòng Thời gian (Timeline)**: Chia giao diện làm 2 phần My Drive và Photos. Ở chế độ Photos, toàn bộ ảnh được gộp và hiển thị theo Ngày Tháng giống hệt Google Photos.
- [x] **Tải theo Cụm (Chunk Render/Load More)**: Cơ chế tối ưu bộ nhớ trình duyệt, ngăn chặn việc giật lag khi có hàng vạn bức ảnh hiển thị cùng lúc.

### Giai đoạn 9: Tính năng Cao cấp & Bảo mật Tuyệt đối
- [x] **Trí tuệ nhân tạo (AI Image Tagging)**: Tích hợp mô hình AI `MobileNet` trực tiếp vào trình duyệt qua `TensorFlow.js`. AI chạy ngầm bằng `Web Worker` để tự động nhận diện ảnh (chó, mèo, biển, xe cộ, tài liệu...) mà không làm giật ứng dụng. Thanh tìm kiếm có thể lọc ảnh bằng từ khóa tiếng Việt.
- [x] **Hạ tầng Video Streaming**: Thiết lập Service Worker cục bộ mở luồng kết nối đa luồng `postMessage` tới lõi MTProto của Telegram, sẵn sàng cho việc tua và phát trực tiếp Video không cần tải toàn bộ file.
- [x] **Tải toàn bộ Thư mục (Folder Upload)**: Tận dụng kiến trúc Thư mục Ảo (VFS) và thuộc tính `webkitdirectory` để cho phép tải lên hàng vạn ảnh từ một thư mục gốc, tự động tái tạo lại chuẩn xác các lớp thư mục con bên trong ứng dụng.
- [x] **Giao diện Tối (Dark Mode)**: Bổ sung thanh chuyển đổi giao diện Sáng/Tối bảo vệ mắt, thiết lập lưu cấu hình vào `localStorage`.

### Giai đoạn 10: Tối ưu Toàn diện & Auto-Chunking ZIP
- [x] **Responsive Mobile UI/UX**: Tái cấu trúc thanh công cụ Tìm kiếm và Điều hướng cho di động. Giải quyết dứt điểm lỗi tràn chữ tên file dài gây vỡ khung Xem trước (Preview Modal) bằng cơ chế Flex/Ellipsis.
- [x] **Tính năng Tìm kiếm Thư viện Ảnh**: Mở khóa thanh tìm kiếm toàn cầu cho thẻ Photos, cho phép lọc ảnh và video theo tên và nhãn dán (Tag) kết hợp AI mà không làm hỏng cấu trúc lưới Grid.
- [x] **Ghi đè File Thông minh (Auto-Overwrite)**: Trước khi tải lên, hệ thống tự động quét và tiêu hủy file cũ nếu có trùng lặp tên và đường dẫn trong cùng thư mục, ngăn chặn rác dữ liệu.
- [x] **Nén ZIP Tự động Chia Lô (Auto-Chunking)**: Tích hợp `JSZip`, cho phép "Tải xuống Tất cả" kho ảnh. Ứng dụng tự động theo dõi RAM và cắt file ZIP xuất ra theo từng Part (Giới hạn 5GB/Part theo cấu hình máy tính mạnh) để tránh Crash trình duyệt.

---
*Dự án đang được phát triển liên tục bởi Antigravity AI.*
