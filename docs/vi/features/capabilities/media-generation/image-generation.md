---
title: "Tạo hình ảnh"
sidebar:
  order: 1
---

TomoriBot có thể tạo hình ảnh từ lời nhắc văn bản hoặc bằng cách chỉnh sửa hình ảnh tham chiếu. Sử dụng `/generate image` hoặc mô tả những gì bạn muốn trong cuộc trò chuyện ("vẽ gấu trúc đỏ uống cà phê").

## Những việc bot có thể làm

- **Chuyển văn bản thành hình ảnh**: tạo hình ảnh từ mô tả.
- **Hình ảnh thành hình ảnh**: chỉnh sửa hoặc tạo kiểu lại cho hình ảnh hiện có.
- **Inpainting**: vẽ lại một vùng cụ thể trong khi giữ nguyên phần còn lại.
- **Outpainting**: mở rộng khung vẽ ra ngoài khung ban đầu.
- **Tỷ lệ khung hình có thể tùy chỉnh**.
- **Hình ảnh tham khảo**: lấy từ tệp đính kèm tin nhắn, sticker, biểu tượng cảm xúc hoặc hình đại diện của người dùng và cá nhân. Đề cập đến người dùng hoặc cá nhân để lấy hình đại diện của họ làm tài liệu tham khảo.

Chế độ chỉnh sửa nào khả dụng tùy thuộc vào chương trình phụ trợ đang hoạt động. Tính năng chuyển văn bản thành hình ảnh và hình ảnh thành hình ảnh hoạt động trên các nhà cung cấp đám mây (Google, Vertex, OpenRouter). Inpainting và outpainting được hỗ trợ bởi các điểm cuối tùy chỉnh [ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/) cục bộ và phụ thuộc vào khả năng được khai báo của điểm cuối đó. Các chế độ mà thiết lập của bạn không hỗ trợ sẽ tự động bị ẩn khỏi model.

Khi cô ấy tạo một hình ảnh, cô ấy kết hợp các thẻ xuất hiện của cá nhân bạn với các thẻ tích cực và tiêu cực trên toàn máy chủ (nếu được hỗ trợ). Kết quả xuất hiện dưới dạng thư viện phương tiện Discord với các chi tiết về thế hệ, bao gồm mọi người dùng hoặc cá tính được tham chiếu.

## Tùy chỉnh thẻ tag
<!-- anchor: tag-customization -->

Mọi nguồn thẻ đều có thể được chỉnh sửa tại chỗ bằng một phương thức điền sẵn:

- **`/config` > `Persona` > `Chi tiết tạo hình ảnh`**: thẻ `Ngoại hình` của người được chọn (trông cô ấy như thế nào). Yêu cầu quyền Quản lý máy chủ.
- **`/personal config`**: thẻ xuất hiện của riêng bạn, được áp dụng bất cứ khi nào thế hệ hình ảnh tham chiếu đến bạn. Theo dõi bạn trên mọi máy chủ (xem [Cá nhân hóa](/vi/features/knowledge/personalization/)).
- **`/config` > `Model` > `Mặc định tạo hình ảnh`**: sử dụng `Sửa tích cực` và `Sửa tiêu cực` để đặt các thẻ mặc định được thêm vào hoặc loại bỏ khỏi mọi thế hệ. Thẻ phủ định chỉ áp dụng khi phần phụ trợ hỗ trợ lời nhắc phủ định. Việc gửi một ô trống sẽ đặt lại các giá trị mặc định tích hợp sẵn.

## Thiết lập

1. Định cấu hình model hình ảnh với `/config` > `Model` > Chuyển model.
2. Bật tạo hình ảnh trong `/config` > `Quyền hạn` (`imagegen_enabled`).
3. Hỏi cô ấy trong phần trò chuyện hoặc chạy `/generate image`.

## Hỗ trợ nhà cung cấp

Tạo hình ảnh gốc có sẵn trên Google, Vertex AI, Vertex AI Express, OpenRouter, Z.ai, NVIDIA NIM và NovelAI (theo kiểu anime). Để biết ma trận nhà cung cấp đầy đủ, hãy xem [Nhà cung cấp & Model](/vi/features/setup-administration/providers-and-models/#supported-providers).

Để tạo cục bộ trên phần cứng của riêng bạn thông qua ComfyUI, hãy xem [Thiết lập: ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/).
