---
title: "Thiết lập: ComfyUI"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot có thể tạo hình ảnh và video thông qua phiên bản
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) của riêng bạn. Bot điều khiển ComfyUI bằng cách
gửi một quy trình làm việc định dạng API với prompt/kích thước của bạn được thay thế vào, sau đó liên tục thăm dò
endpoint `/history` của ComfyUI cho đến khi kết quả đầu ra sẵn sàng.

Hướng dẫn này bao gồm việc cài đặt/chạy ComfyUI và đăng ký dịch vụ. Để tạo hoặc chỉnh sửa
quy trình làm việc tương thích với TomoriBot (các placeholder `{TOMORI_*}`), hãy sử dụng phần hướng dẫn chuyên sâu
trong Discord bằng cách mở `/help`, chọn `Tính năng`, rồi `Endpoint tùy chỉnh`, và sử dụng
[README quy trình làm việc](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)
trên GitHub.

:::note[Không cần biến môi trường]
ComfyUI được đăng ký thông qua các lệnh slash trên Discord và được lưu trữ mã hóa trong cơ sở dữ liệu.
Xem [trung tâm endpoint cục bộ](/vi/self-hosting/local-endpoints/).
:::

## Yêu cầu phần cứng

Việc tạo hình ảnh và video phụ thuộc rất lớn vào GPU: chi phí nặng nề nhất nằm ở VRAM (bộ nhớ
của card đồ họa, tách biệt với RAM hệ thống), được quyết định bởi checkpoint model mà quy trình làm việc nạp vào,
chứ không phải bởi chính ComfyUI. Bạn rất nên sử dụng GPU NVIDIA. Hai quy trình làm việc đi kèm TomoriBot
đều là các model hiện đại và nặng hơn SDXL:

| Quy trình làm việc đi kèm | Model nền tảng | VRAM thực tế | Ghi chú |
|---|---|---|---|
| Anima v1 (hình ảnh) | Qwen-Image (~20B), fp8 | ~16 GB mức tối thiểu · 24 GB thoải mái | Bộ mã hóa văn bản + VAE chiếm thêm ~8-10 GB tài nguyên. Dưới 16 GB, hãy sử dụng bản dựng GGUF + `--lowvram`. |
| WAN i2v loop (video) | Wan 2.2 14B, fp8 + 4-step LightX2V LoRAs | ~16 GB dùng được · 24 GB+ thoải mái | Tùy chọn nặng nhất, dự kiến mất vài phút cho mỗi clip. Giảm tải bộ mã hóa văn bản UMT5 sang RAM (`t5_cpu`, yêu cầu RAM hệ thống 24 GB+) trên các card đồ họa nhỏ hơn. |

Cả hai checkpoint đi kèm đều đã được lượng hóa fp8 để vừa vặn với card đồ họa người dùng phổ thông. Nếu bạn có ít
VRAM hơn, hãy đổi UNET sang bản lượng hóa nhỏ hơn và bật `--lowvram` / CPU offload của ComfyUI. Việc tạo ảnh hoàn toàn bằng CPU là
không thực tế (mất nhiều phút cho mỗi hình ảnh, thậm chí lâu hơn cho video) và có thể vượt quá thời gian thăm dò của TomoriBot,
vì vậy GPU gần như là bắt buộc để sử dụng thường xuyên.

:::tip[Giảm dung lượng hơn nữa: chọn bản lượng hóa GGUF]
Lượng hóa (Quantization) lưu trữ từng trọng số model bằng ít bit hơn để cắt giảm VRAM và dung lượng ổ đĩa, với mức đánh đổi
độ chính xác rất nhỏ. Các tệp fp8 đi kèm là một dạng lượng hóa nhẹ của phương pháp này, và để thu nhỏ hơn nữa, hãy tải bản
dựng GGUF của model từ Hugging Face: mã trong các tên như `Q4_K_M` / `Q5_K_M` biểu thị số bit trên mỗi trọng số, và 4-bit (Q4) hoặc 5-bit (Q5) là điểm cân bằng lý tưởng
giữ lại hầu hết chất lượng với kích thước chỉ bằng một phần nhỏ so với fp8/fp16. Dưới 4-bit sẽ giảm dung lượng nhiều hơn nhưng chất lượng suy giảm nhanh chóng. Việc tải
UNET GGUF trong ComfyUI cần custom node [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::

## 1. Chạy ComfyUI với API được bật

Cài đặt ComfyUI theo [README của dự án](https://github.com/comfyanonymous/ComfyUI) và khởi động để ứng dụng
lắng nghe trên mạng:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

Cờ `--listen 0.0.0.0` rất quan trọng nếu TomoriBot chạy trong Docker hoặc trên một máy khác: cấu hình
mặc định chỉ liên kết với loopback. Xác nhận khả năng truy cập từ máy mà bot đang chạy:

```sh
curl http://127.0.0.1:8188/system_stats
```

Nếu muốn kiểm tra, hãy tải các checkpoint model mà quy trình bạn chọn yêu cầu và thực hiện một lần tạo ảnh thủ công trên giao diện
web ComfyUI để xác nhận hệ thống hoạt động thông suốt từ đầu đến cuối trước khi kết nối với TomoriBot.

## 2. Lấy quy trình làm việc TomoriBot

Tải xuống quy trình làm việc định dạng API sẵn sàng sử dụng. Các ví dụ có thể tìm thấy trong kho lưu trữ tại mục
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Quy trình làm việc | Các chế độ |
|----------|-------|
| Anima v1 (hình ảnh): `tomoribot-anima-v1-comfyui.json` | `txt2img`, `img2img`, `inpaint` |
| WAN i2v loop (video): `tomoribot-wan-i2v-loop-video.json` | image-to-video |

Các tệp này ở định dạng API (JSON mà ComfyUI xuất thông qua *Save (API Format)*), không phải định dạng
lưu giao diện thông thường. Nếu tự tạo quy trình riêng, tệp phải chứa các placeholder `{TOMORI_*}`
mà TomoriBot sẽ thay thế (prompt, width/height, seed, ảnh tham chiếu, v.v.). Xem README quy trình
làm việc và trang `Endpoint tùy chỉnh` trong mục Providers tại `/help`.

## 3. Đăng ký trong Discord

Chạy `/providers` (hoặc `/personal providers`), chọn `Thêm endpoint tùy chỉnh mới`, và nhập:

| Trường | Giá trị cho ComfyUI |
|-------|-------------------|
| `endpoint_label` | Tên bạn chọn, ví dụ `home-comfy` |
| API Compatibility | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (gốc, không có `/v1`) |
| `auth_token` | *(để trống trừ khi ComfyUI của bạn yêu cầu xác thực)* |

Sau khi lưu kết nối, chọn kết nối đó và sử dụng menu dropdown model để thêm model Image hoặc Video.
Nhập chính xác tên mã của checkpoint và tải lên tệp `.json` quy trình làm việc mà bạn đã tải về
từ Bước 2. Tính năng của model phải khớp với quy trình làm việc (quy trình hình ảnh → `image`, quy trình
video → `video`).

Model hình ảnh cũng sẽ yêu cầu khai báo `Tính năng hình ảnh`: chuyển văn bản thành hình ảnh, hình ảnh tham chiếu,
inpainting và prompt phủ định. Chỉ đánh dấu các chế độ mà quy trình làm việc của bạn thực sự hỗ trợ, vì
Tomori chỉ cung cấp cho công cụ các chế độ mà bạn đã khai báo. Inpainting chỉ xuất hiện cho các kết nối ComfyUI,
vì không có khả năng tương thích API nào khác chấp nhận mặt nạ. Việc chỉnh sửa model sau này sẽ mở lại biểu mẫu
với các lựa chọn hiện tại của bạn, do đó việc thay đổi tên mã sẽ không làm mất các lựa chọn này.

Việc thêm model sẽ tự động đặt model đó làm model `image`/`video` đang hoạt động. Kích hoạt tạo ảnh/video bằng cách yêu cầu trực tiếp Tomori trong đoạn chat. Nếu vì lý do nào đó model chưa hoạt động, hãy chạy `/config` > Models > Switch Models
và chọn endpoint ComfyUI đã đăng ký của bạn.

## Khắc phục sự cố

- Không thể kết nối khi thêm: ComfyUI chỉ liên kết với loopback trong khi bot chạy trong Docker hoặc trên máy chủ
  khác. Khởi động ComfyUI với `--listen 0.0.0.0` và sử dụng `http://host.docker.internal:8188` hoặc
  IP mạng cục bộ LAN.
- Quá trình tạo không bao giờ hoàn tất: TomoriBot liên tục kiểm tra `/history` cho đến khi kết quả xuất hiện. Việc
  khởi động nguội và các model lớn chạy trên CPU có thể vượt quá khoảng thời gian chờ thăm dò.
- Bỏ qua prompt/kích thước hoặc kích thước đầu ra sai: quy trình làm việc bị thiếu các placeholder
  `{TOMORI_*}` bắt buộc, hoặc bạn đã tải lên tệp xuất dạng giao diện UI thay vì định dạng API.
- Sai tính năng: quy trình làm việc `image` được đăng ký dưới dạng `video` (hoặc ngược lại) sẽ không thể
  chạy. Hãy thêm lại dưới đúng tính năng tương ứng.
