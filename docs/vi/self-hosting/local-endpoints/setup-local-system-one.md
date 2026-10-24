---
title: "Thiết lập: Model quyết định cục bộ"
sidebar:
  order: 7
aiGenerated: true
---

Chạy một model quyết định nhỏ trên chính máy của bạn và đăng ký vào TomoriBot. Model quyết định trả lời các câu hỏi về một đoạn văn bản, chẳng hạn như có hoặc không, hoặc chủ đề nào trong số nhiều chủ đề phù hợp, kèm theo xác suất. [Kev](https://github.com/jaredpalmer/kev) là một model nguồn mở sử dụng giao thức System One, cùng loại giao thức mà Jev do TypeSafe lưu trữ sử dụng.

:::note[Mục đích sử dụng]
Sau khi được chọn trong `/config` > `Model` > `Chuyển đổi model`, hoặc làm Trình kiểm tra gợi ý chủ động trong `/config` > `Plugins` > `Natural Nudges`, model quyết định sẽ xác định thời điểm [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges) tham gia vào cuộc trò chuyện bằng cách yêu cầu nó chọn một chủ đề trong số nhiều chủ đề. Xem [Model quyết định](/features/setup-administration/providers-and-models/#decision-models) để biết chi tiết.
:::

## 1. Chạy Kev

Kev cần [Git](https://git-scm.com), [uv](https://docs.astral.sh/uv/) và Python 3.12 hoặc 3.13 (uv sẽ tự động cài đặt cho bạn). Hãy chọn kích thước phù hợp với GPU của bạn:

| Model | ID trên Hub | Dung lượng trọng số (ước tính) | Ghi chú |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | Chạy trên GPU 4 GB. Độ chính xác thấp nhất. |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | Điểm khởi đầu được khuyến nghị của Kev nếu vừa với bộ nhớ GPU của bạn. |

README của Kev liệt kê CUDA, ROCm và Apple Silicon. Các bước Windows dưới đây đã được kiểm tra trên Windows gốc với GPU NVIDIA. Nếu máy chủ không thể khởi động trên cấu hình của bạn, hãy thực hiện các bước tương tự trong WSL2.

Sao chép kho lưu trữ vào một thư mục bên ngoài thư mục TomoriBot:

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

Trên Windows với GPU NVIDIA, `uv sync` sẽ cài đặt PyTorch chỉ hỗ trợ CPU, vốn quá chậm. Hãy thay thế bằng bản build CUDA và kiểm tra xem nó có nhận diện GPU của bạn không:

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

Lệnh phải in ra `True`. Từ lúc này, hãy khởi động Kev bằng `uv run --no-sync`, vì lệnh `uv run` thông thường sẽ đồng bộ hóa lại bản build CPU. Trên Linux và macOS, hãy dùng `uv run --extra serve`.

Khởi động máy chủ. Lần chạy đầu tiên sẽ tải xuống model nên mất vài phút:

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda` khiến Kev báo lỗi rõ ràng nếu không thể sử dụng GPU của bạn thay vì âm thầm chạy trên CPU. Hãy dùng `jaredpalmer/kev-0.8b` nếu Kev-4B bị tràn bộ nhớ. Trên Mac, hãy bỏ `--device cuda`.

Giữ máy chủ hoạt động và kiểm tra từ một cửa sổ PowerShell khác. Lệnh đầu tiên liệt kê tên model và lệnh thứ hai trả về xác suất từ 0 đến 1 cho câu hỏi có/không:

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

Kev sẽ in cảnh báo thiếu `flash-linear-attention`. Sau đó nó sẽ sử dụng một đường dẫn chậm hơn nhưng cho kết quả tương đương, vì vậy bạn có thể bỏ qua cảnh báo này.

## 2. Đăng ký trong Discord

Chạy `/providers` (cho toàn máy chủ) hoặc `/personal providers` (chỉ riêng bạn), chọn `Add New Custom Endpoint` và nhập:

| Trường | Giá trị |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | Để trống, trừ khi bạn đã đặt `KEV_API_KEY` |

TomoriBot kiểm tra `GET /v1/models` khi bạn lưu. Máy chủ trả lời `404` hoặc `405` vẫn được chấp nhận.

Mở endpoint `kev` đã lưu, chọn `+ Thêm một model quyết định` từ menu thả xuống model và nhập:

- `Code Name`: `kev-latest`, tên model mà các ví dụ của Kev sử dụng.
- `Context Window`: `8192`, độ dài văn bản tối đa mà Kev-0.8B và Kev-4B được xác thực. Kev từ chối bất kỳ văn bản nào vượt quá 65.536 token.

## 3. Chọn model

Mở `/config` > `Model` > `Chuyển đổi model` và chọn `kev-latest` trong ô `Quyết định`. `- Không có model` sẽ xóa lựa chọn mà không xóa thông tin đăng ký.

## Ghi chú và lưu ý

- **Dừng máy chủ**: bấm `Ctrl+C`. TomoriBot không tự động khởi động hoặc dừng Kev cho bạn.
- **TomoriBot chạy trong Docker?** `127.0.0.1` bên trong container không phải là máy chủ thật của bạn. Hãy dùng `http://host.docker.internal:8009/v1` và khởi động Kev với `--host 0.0.0.0`. Kev mặc định không yêu cầu đăng nhập, vì vậy hãy đặt `KEV_API_KEY` trước và điền giá trị tương tự vào `Auth Token`.
- **Môi trường vận hành chính thức**: bắt buộc sử dụng HTTPS và chặn các địa chỉ riêng tư đối với endpoint của nhà cung cấp. URL HTTP cục bộ hoạt động khi `RUN_ENV=development`. Xem [LLM cục bộ](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas).
- **Các máy chủ System One khác**: chẳng hạn như Laya, áp dụng cùng các bước với URL và tên model riêng. Máy chủ triển khai API OpenAI Decisions sẽ sử dụng `OpenAI Decisions compatible` để thay thế.
