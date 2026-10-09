---
title: "Danh mục lệnh"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run `bun run generate-command-reference` from the repository root.
-->

Tất cả các lệnh slash hiện được TomoriBot đăng ký, được tạo từ cùng trình xây dựng lệnh và mô tả tiếng Việt dùng để đăng ký trên Discord (mô tả chưa được dịch sẽ hiển thị bằng tiếng Anh).

Các nhóm lệnh cấp cao nhất: **41**. Các lệnh slash có thể thực thi: **85**.

## `/comment`

Gửi embed bình luận hiển thị trong chat nhưng ẩn trong ngữ cảnh.

| Lệnh | Tóm tắt |
|---|---|
| `/comment` | Gửi embed bình luận hiển thị trong chat nhưng ẩn trong ngữ cảnh. |

## `/compact`

Tóm tắt cuộc trò chuyện gần đây thành bộ nhớ hệ thống rút gọn.

| Lệnh | Tóm tắt |
|---|---|
| `/compact` | Tóm tắt cuộc trò chuyện gần đây thành bộ nhớ hệ thống rút gọn. |

## `/conditioning`

Quản lý bộ nhớ điều hòa thưởng và phạt dài hạn.

| Lệnh | Tóm tắt |
|---|---|
| `/conditioning manage` | Quản lý lịch sử điều hòa được đưa vào trên mọi persona trong máy chủ này. |
| `/conditioning remove` | Xóa các mục điều hòa trên mọi persona trong máy chủ này. |

## `/config`

Cấu hình persona, hành vi, kênh, quyền hạn và cài đặt model.

| Lệnh | Tóm tắt |
|---|---|
| `/config` | Cấu hình persona, hành vi, kênh, quyền hạn và cài đặt model. |

## `/context`

Xem prompt của một persona chiếm bao nhiêu dung lượng cửa sổ ngữ cảnh của model trong kênh này.

| Lệnh | Tóm tắt |
|---|---|
| `/context` | Xem prompt của một persona chiếm bao nhiêu dung lượng cửa sổ ngữ cảnh của model trong kênh này. |

## `/contribute`

Tìm mã nguồn và các cách giúp xây dựng TomoriBot.

| Lệnh | Tóm tắt |
|---|---|
| `/contribute github` | Nhận liên kết kho lưu trữ GitHub và tìm hiểu cách đóng góp cho TomoriBot. |

## `/donate`

Ủng hộ chi phí phát triển và lưu trữ của TomoriBot.

| Lệnh | Tóm tắt |
|---|---|
| `/donate kofi` | Ủng hộ phát triển TomoriBot qua quyên góp Ko-fi. |

## `/export`

Xuất cấu hình hoặc bộ nhớ thành tệp di động.

| Lệnh | Tóm tắt |
|---|---|
| `/export config` | Xuất cấu hình máy chủ này thành tệp di động. |
| `/export memories` | Xuất bộ nhớ thành tệp di động. |
| `/export personal config` | Xuất cấu hình cá nhân của bạn thành tệp di động. |
| `/export personal memories` | Xuất bộ nhớ thuộc sở hữu tài khoản bạn thành tệp di động. |

## `/expressions`

Dạy TomoriBot khi nào nên dùng emoji và sticker tùy chỉnh của máy chủ này.

| Lệnh | Tóm tắt |
|---|---|
| `/expressions initialize` | Phân tích và phân loại toàn bộ emoji và sticker tùy chỉnh bằng AI vision |
| `/expressions manage` | Quản lý emoji, sticker, biểu cảm tùy chỉnh và quyền truy cập của persona. |

## `/generate`

Tạo hình ảnh, video và tin nhắn thoại bằng AI.

| Lệnh | Tóm tắt |
|---|---|
| `/generate image` | Tạo ảnh AI từ prompt của bạn hoặc từ ngữ cảnh kênh hiện tại |
| `/generate scene` | Tạo một đoạn kịch bản ngắn giữa các persona đã chọn. |
| `/generate video` | Tạo video AI bằng Google Veo, OpenRouter hoặc Z.ai |
| `/generate voice-message` | Nói tin nhắn bằng giọng đọc bạn chọn |

## `/help`

Xem hướng dẫn thiết lập, tính năng, nhà cung cấp, bộ nhớ, hành vi, công cụ, media và tích hợp.

| Lệnh | Tóm tắt |
|---|---|
| `/help` | Xem hướng dẫn thiết lập, tính năng, nhà cung cấp, bộ nhớ, hành vi, công cụ, media và tích hợp. |

## `/impersonate`

Mạo danh persona, người dùng hoặc đưa vào prompt hệ thống.

| Lệnh | Tóm tắt |
|---|---|
| `/impersonate persona` | Gửi tin nhắn dưới danh nghĩa một persona của máy chủ này. |
| `/impersonate system` | Đưa tin nhắn hệ thống vào ngữ cảnh cuộc trò chuyện. |
| `/impersonate user` | Để bot soạn và gửi tin nhắn như thể chính thành viên đó gửi. |

## `/import`

Nhập cấu hình hoặc bộ nhớ từ tệp di động.

| Lệnh | Tóm tắt |
|---|---|
| `/import config` | Nhập tệp cấu hình máy chủ. |
| `/import memories` | Nhập tệp bộ nhớ máy chủ. |
| `/import personal config` | Nhập tệp cấu hình cá nhân. |
| `/import personal memories` | Nhập tệp bộ nhớ cá nhân. |

## `/kill`

Dừng ngay luồng phát hiện tại và xóa phản hồi đang chờ trong kênh này.

| Lệnh | Tóm tắt |
|---|---|
| `/kill` | Dừng ngay luồng phát hiện tại và xóa phản hồi đang chờ trong kênh này. |

## `/learn`

Học, trích xuất và nạp lịch sử cuộc trò chuyện vào bộ nhớ.

| Lệnh | Tóm tắt |
|---|---|
| `/learn history` | Dùng AI để trích xuất kiến thức từ lịch sử tin nhắn của kênh này. |

## `/legal`

Xem điều khoản dịch vụ, chính sách quyền riêng tư và giấy phép của TomoriBot.

| Lệnh | Tóm tắt |
|---|---|
| `/legal license` | Xem giấy phép nguồn mở của TomoriBot |
| `/legal privacy-policy` | Xem chính sách quyền riêng tư của TomoriBot |
| `/legal terms-of-service` | Xem điều khoản dịch vụ của TomoriBot |

## `/matrix`

Liên kết kênh Discord với phòng Matrix để chuyển tiếp hai chiều.

| Lệnh | Tóm tắt |
|---|---|
| `/matrix link` | Liên kết kênh Discord với phòng Matrix để chuyển tiếp hai chiều |
| `/matrix unlink` | Xóa liên kết cầu nối Matrix khỏi một kênh Discord |

## `/memories`

Kiểm tra và quản lý bộ nhớ máy chủ, tài liệu và bộ nhớ ngắn hạn.

| Lệnh | Tóm tắt |
|---|---|
| `/memories` | Kiểm tra và quản lý bộ nhớ máy chủ, tài liệu và bộ nhớ ngắn hạn. |

## `/model`

Quản lý các model AI mặc định của máy chủ này.

| Lệnh | Tóm tắt |
|---|---|
| `/model override remove` | Xóa các tùy chỉnh model cho kênh và persona. |

## `/moderation`

Quản lý quyền thành viên, blacklist, whitelist kênh và vai trò, cùng cài đặt hạn ngạch.

| Lệnh | Tóm tắt |
|---|---|
| `/moderation` | Quản lý quyền thành viên, blacklist, whitelist kênh và vai trò, cùng cài đặt hạn ngạch. |

## `/novelai`

Cấu hình tạo văn bản và hình ảnh NovelAI cho máy chủ này.

| Lệnh | Tóm tắt |
|---|---|
| `/novelai generate image` | Tạo ảnh NovelAI dùng thẻ kiểu imageboard và tham chiếu nhân vật tùy chọn. |
| `/novelai usage` | Xem mức sử dụng lượt tạo NovelAI Opus của máy chủ (cần quyền Quản lý máy chủ). |

## `/nsfw`

Các lệnh và cài đặt giới hạn độ tuổi.

| Lệnh | Tóm tắt |
|---|---|
| `/nsfw jailbreaks` | Quản lý các hành vi jailbreak tùy chọn cho prompt của mình trên máy chủ này. |
| `/nsfw persona default` | Áp dụng cấu hình preset persona NSFW |
| `/nsfw persona import` | Nhập persona từ tệp PNG, JSON hoặc CHARX, bao gồm cả persona NSFW |

## `/nuke`

Xóa sạch toàn bộ dữ liệu máy chủ. Yêu cầu chạy lại /setup sau đó.

| Lệnh | Tóm tắt |
|---|---|
| `/nuke` | Xóa sạch toàn bộ dữ liệu máy chủ. Yêu cầu chạy lại /setup sau đó. |

## `/persona`

Quản lý các preset persona

| Lệnh | Tóm tắt |
|---|---|
| `/persona create` | Tạo thủ công một preset persona đơn giản |
| `/persona default` | Áp dụng cấu hình preset persona |
| `/persona export` | Xuất persona hiện tại thành tệp PNG có thể chia sẻ |
| `/persona generate` | Tạo persona bằng AI (yêu cầu nhà cung cấp tương thích) |
| `/persona import` | Nhập persona từ tệp PNG, JSON hoặc CHARX |
| `/persona remove` | Xóa một persona alter khỏi máy chủ |

## `/personal`

Quản lý cài đặt cá nhân của bạn

| Lệnh | Tóm tắt |
|---|---|
| `/personal config` | Quản lý tùy chọn cá nhân, quyền riêng tư, model và hồ sơ. |
| `/personal language` | Chọn ngôn ngữ TomoriBot dùng để nói chuyện với bạn. |
| `/personal memories` | Quản lý bộ nhớ dài hạn cá nhân và ngữ cảnh hội thoại ngắn hạn. |
| `/personal nuke` | Xóa mọi thứ TomoriBot lưu trữ về bạn trên mọi máy chủ. |
| `/personal providers` | Quản lý thông tin xác thực, endpoint và danh mục model cá nhân. |

## `/ping`

Kiểm tra độ trễ của bot.

| Lệnh | Tóm tắt |
|---|---|
| `/ping` | Kiểm tra độ trễ của bot. |

## `/providers`

Thêm, xem, chỉnh sửa và xóa thông tin xác thực nhà cung cấp, endpoint và danh mục model.

| Lệnh | Tóm tắt |
|---|---|
| `/providers` | Thêm, xem, chỉnh sửa và xóa thông tin xác thực nhà cung cấp, endpoint và danh mục model. |

## `/punish`

Phạt mình bằng các tương tác trêu đùa.

| Lệnh | Tóm tắt |
|---|---|
| `/punish bite` | Cắn yêu mình một cái nào! |
| `/punish bonk` | Gõ đầu mình một cái nào! |
| `/punish pinch` | Véo mình một cái nào! |
| `/punish spank` | Tét đòn nhẹ mình nào! |
| `/punish squeeze` | Bóp nhẹ mình một cái nào! |

## `/quota`

Quản lý đặt lại hạn ngạch tạo sinh.

| Lệnh | Tóm tắt |
|---|---|
| `/quota reset global` | Đặt lại nhóm hạn ngạch tạo sinh trên toàn máy chủ. |
| `/quota reset user` | Đặt lại mức sử dụng hạn ngạch hàng ngày của người dùng. |

## `/refresh`

Xóa lịch sử trò chuyện (chỉ kênh này).

| Lệnh | Tóm tắt |
|---|---|
| `/refresh` | Xóa lịch sử trò chuyện (chỉ kênh này). |

## `/reset`

Đặt lại cấu hình máy chủ hoặc cá nhân về mặc định.

| Lệnh | Tóm tắt |
|---|---|
| `/reset config` | Đặt lại cấu hình của máy chủ này về mặc định cơ sở dữ liệu. |
| `/reset personal config` | Đặt lại cấu hình cá nhân của bạn về mặc định cơ sở dữ liệu. |

## `/respond`

Kích hoạt phản hồi thủ công cho tin nhắn mới nhất trong kênh này.

| Lệnh | Tóm tắt |
|---|---|
| `/respond` | Kích hoạt phản hồi thủ công cho tin nhắn mới nhất trong kênh này. |

## `/reward`

Thưởng cho mình bằng các tương tác thú vị.

| Lệnh | Tóm tắt |
|---|---|
| `/reward feed` | Cho mình ăn món gì ngon đi! |
| `/reward headpat` | Xoa đầu mình nào! |
| `/reward hug` | Ôm mình một cái nào! |
| `/reward kiss` | Hôn mình một cái nào! |
| `/reward tickle` | Cù lét mình nào! |

## `/scheduled-task`

Quản lý tác vụ đã lên lịch và lời nhắc.

| Lệnh | Tóm tắt |
|---|---|
| `/scheduled-task edit` | Chỉnh sửa tác vụ đã lên lịch hoặc lời nhắc. |
| `/scheduled-task remove` | Xóa tác vụ đã lên lịch hoặc lời nhắc. |

## `/setup`

Bắt đầu quá trình thiết lập ban đầu. Cấu hình nhà cung cấp AI và tính cách.

| Lệnh | Tóm tắt |
|---|---|
| `/setup` | Bắt đầu quá trình thiết lập ban đầu. Cấu hình nhà cung cấp AI và tính cách. |

## `/stats`

Xem thống kê sử dụng

| Lệnh | Tóm tắt |
|---|---|
| `/stats generate` | Tạo thẻ ảnh thống kê có thể chia sẻ. |
| `/stats persona` | Xem thống kê sử dụng của persona trên máy chủ này. |
| `/stats personal` | Xem thống kê sử dụng của bạn. |
| `/stats server` | Xem thống kê sử dụng trên toàn máy chủ. |

## `/status`

Xem trạng thái hiện tại của cá nhân, máy chủ hoặc persona.

| Lệnh | Tóm tắt |
|---|---|
| `/status` | Xem trạng thái hiện tại của cá nhân, máy chủ hoặc persona. |

## `/support`

Nhận trợ giúp, báo lỗi và tham gia cộng đồng TomoriBot.

| Lệnh | Tóm tắt |
|---|---|
| `/support discord` | Nhận liên kết máy chủ Discord chính thức để báo lỗi, góp ý và trò chuyện. |

## `/tool`

Các thao tác tiện ích cho ngữ cảnh hội thoại, prompt và chẩn đoán.

| Lệnh | Tóm tắt |
|---|---|
| `/tool delete turn` | Xóa lượt trò chuyện gần nhất của persona khỏi kênh. |
| `/tool estimate cost` | Ước tính chi phí API cho các nhà cung cấp AI trả phí |
| `/tool prompt snapshot` | Xuất chính xác prompt LLM của một persona ra tệp để gỡ lỗi. |

## `/troubleshoot`

Nhận trợ giúp về những gì TomoriBot đã thực hiện.

| Lệnh | Tóm tắt |
|---|---|
| `/troubleshoot chat` | Tạo tệp riêng tư về sự cố trò chuyện gần đây. |

## `/update`

Xem ghi chú phát hành mới nhất của TomoriBot

| Lệnh | Tóm tắt |
|---|---|
| `/update` | Xem ghi chú phát hành mới nhất của TomoriBot |
