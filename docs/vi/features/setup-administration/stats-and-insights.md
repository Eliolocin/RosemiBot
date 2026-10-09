---
title: "Thống kê và thông tin chuyên sâu"
sidebar:
  order: 4
---

TomoriBot theo dõi số liệu tương tác để bạn có thể kiểm tra xu hướng hoạt động, mức sử dụng mã thông báo model, các tính cách phổ biến và lệnh gọi công cụ hoặc hiển thị thẻ tóm tắt đồ họa thông tin có thể chia sẻ.

## Bảng điều khiển dạng văn bản

Ba lệnh mở bảng thông tin tương tác theo thẻ:

- `/stats personal`: xem số liệu thống kê sử dụng của riêng bạn.
- `/stats persona`: xem số liệu thống kê sử dụng của một người cụ thể trên máy chủ này.
- `/stats server`: xem số liệu thống kê trên toàn máy chủ của tất cả các thành viên và cá tính.

Mỗi trang tổng quan bao gồm các tab Tổng quan, Tính cách, Model & Chi phí, Công cụ & Lệnh, Biểu thức, Người yêu thích và Bảng xếp hạng.

Hầu hết các lệnh phụ cho phép bạn chỉ định khoảng thời gian (chẳng hạn như 7 ngày, 30 ngày hoặc mọi lúc). Số liệu thống kê cá nhân có thể được xác định trong phạm vi máy chủ hiện tại hoặc trên tất cả các máy chủ nơi bạn sử dụng TomoriBot.

Bảng điều khiển văn bản là các thông báo công khai lâu dài được kiểm soát bởi kẻ gọi. Chúng vẫn tương tác cho đến khi bị loại bỏ hoặc bị xóa và các thành viên khác không thể thao túng các điều khiển trang tổng quan của bạn.

:::note
Số lượng mã thông báo phản ánh mức sử dụng do nhà cung cấp báo cáo khi có sẵn (ước tính dựa trên ký tự chỉ được sử dụng cho các nhà cung cấp bỏ qua số liệu mã thông báo). Số liệu chi phí định giá các mã thông báo đó theo tỷ giá niêm yết từ danh mục model, vì vậy chúng có thể khác với hóa đơn thực tế của bạn do bộ nhớ đệm nhanh chóng, chiết khấu của nhà cung cấp hoặc hạn ngạch bậc miễn phí.
:::

## Thẻ đồ họa thông tin có thể chia sẻ

Chạy `/stats generate` để hiển thị thẻ hình ảnh tóm tắt tinh tế mà bạn có thể chia sẻ trực tiếp trong cuộc trò chuyện:

- **Personal Wrapped**: tóm tắt hoạt động cá nhân và các persona yêu thích của bạn.
- **Mối quan hệ cá nhân**: làm nổi bật số liệu thống kê của một cá nhân cụ thể và các đối tác trò chuyện hàng đầu trên máy chủ này.
- **Bảng xếp hạng máy chủ**: hiển thị hoạt động trên toàn máy chủ và xếp hạng thành viên.

Người dùng có mức độ riêng tư được đặt thành `Đầy đủ` trong `/personal config` không thể tạo thẻ thống kê cá nhân.

Để biết chi tiết về cách tạo và hiển thị thẻ, hãy xem [hệ thống con đồ họa thông tin thống kê](/en/architecture/subsystems/stats-infographic/).
