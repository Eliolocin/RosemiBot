---
title: "Thiết lập: LLM cục bộ"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot có thể sử dụng bất kỳ máy chủ LLM cục bộ nào tương thích với OpenAI để tạo văn bản và tạo vector nhúng.
Hướng dẫn này sẽ đi qua quy trình bằng cách sử dụng Ollama làm ví dụ vì đây là công cụ dễ bắt đầu nhất.

Khi bạn đã quen thuộc hơn, hãy cân nhắc một máy chủ linh hoạt hơn như
[KoboldCPP](https://github.com/LostRuins/koboldcpp) và sử dụng các model mã nguồn mở trực tiếp từ
[Hugging Face](https://huggingface.co), vì việc lựa chọn và trải nghiệm các model do cộng đồng tạo ra
là một nửa niềm vui khi tự vận hành AI của riêng bạn.

:::note[Không cần biến môi trường]
Các model cục bộ được đăng ký thông qua các lệnh slash của Discord và được lưu trữ mã hóa trong cơ
sở dữ liệu. Không có cài đặt `.env` nào cho chúng. Xem [trung tâm endpoint cục bộ](/vi/self-hosting/local-endpoints/).
:::

## 1. Chạy máy chủ model của bạn

Cài đặt [Ollama](https://ollama.com). Các ví dụ dưới đây sử dụng Gemma 4 của Google nhưng bất kỳ model nào trong [thư viện của Ollama](https://ollama.com/library) đều hoạt động.

### Tôi nên tải kích thước nào?

Các model cục bộ chạy trong VRAM của GPU (bộ nhớ tích hợp trên card đồ họa của bạn, tách biệt
với RAM hệ thống). Quy tắc ngón tay cái: một model cần lượng VRAM trống ít nhất bằng dung lượng tải xuống của nó,
cộng thêm khoảng 1-2 GB dung lượng dự phòng cho ngữ cảnh cuộc trò chuyện. Hãy chọn phiên bản Gemma 4 lớn nhất
vừa vặn với card đồ họa của bạn:

| VRAM GPU của bạn | Bản phù hợp nhất | Dung lượng tải xuống (ước tính) |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b` (vừa hoàn toàn), hoặc `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` hoặc `gemma4:31b` | 18 / 20 GB |

Dung lượng tải xuống là các kích thước lượng hóa mặc định của Ollama; xem
[trang model](https://ollama.com/library/gemma4) để biết số liệu chính xác. Bạn không chắc mình có bao nhiêu VRAM?
Trên Windows: Task Manager → Performance → GPU, đọc mục "Dedicated GPU memory."

:::tip[Tại sao bản 26B có thể vượt trội hơn kích thước của nó]
`gemma4:26b` là một model Mixture-of-Experts (MoE): model này chứa nhiều mạng con "chuyên gia" nhưng
chỉ kích hoạt khoảng ~4B tham số cho mỗi token. Vì vậy, mặc dù dung lượng trọng số ~18 GB không hoàn toàn *vừa*
trong 16 GB, phần nhỏ tràn sang RAM hệ thống hầu như không làm chậm tốc độ như một model dày đặc có cùng kích thước.
Đó là lý do tại sao nó chạy rất mượt mà trên nhiều card 16 GB.
:::

Tải kích thước bạn đã chọn và khởi động máy chủ:

```sh
ollama pull gemma4:12b     # thay bằng thẻ tag phù hợp với VRAM của bạn
ollama serve               # lắng nghe tại http://127.0.0.1:11434
```

Xác nhận có thể kết nối từ máy mà TomoriBot đang chạy:

```sh
curl http://127.0.0.1:11434/v1/models
```

Ghi lại thẻ tag chính xác đã cài đặt, vì đây chính là Model Name bạn sẽ đăng ký:

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Đăng ký trong Discord

Chạy `/providers` (toàn máy chủ) hoặc `/personal providers` (chỉ riêng bạn), chọn
`+ Thêm endpoint tùy chỉnh mới`, và nhập:

| Trường | Giá trị cho Ollama |
|-------|------------------|
| `endpoint_label` | Tên bạn chọn, ví dụ `home-ollama` |
| API Compatibility | `OpenAI-Compatible` (khuyến nghị) hoặc `Ollama` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` cho OpenAI-Compatible · `http://127.0.0.1:11434` cho Ollama |
| `auth_token` | *(để trống)* |

:::tip[Chọn URL khớp với khả năng tương thích API]
Cả `OpenAI-Compatible` và `Ollama` đều chấp nhận URL gốc và tự chuẩn hóa về đường dẫn cơ sở `/v1`.
`/chat/completions` sẽ được tự động thêm vào, vì vậy không thêm nó. Các URL đã có sẵn đường
dẫn, chẳng hạn như `https://openrouter.ai/api/v1` hoặc tiền tố gateway, sẽ được lưu nguyên văn.
:::

Sau khi lưu kết nối, chọn kết nối đó và chọn `+ Thêm model Văn bản mới` từ menu dropdown model của nó.
Điền thông tin:

- Model Name (ID API chính xác): `gemma4:12b`, thẻ tag chính xác từ `ollama list`.
- Context Window Override: tùy chọn, chỉ dành cho Ollama / KoboldCPP. Đặt giá trị này (ví dụ `8192`,
  `16384`) để tăng `num_ctx` mặc định của Ollama, vì mặc định khá nhỏ có thể cắt bớt
  ngữ cảnh dài của TomoriBot. Để trống để sử dụng mặc định của máy chủ.
- Các nút bật tắt: bật `Gọi công cụ` nếu model hỗ trợ function calling; chỉ bật
  `Đầu vào hình ảnh` cho model có khả năng nhìn; bật `Đầu ra có cấu trúc` nếu model xử lý JSON
  schema tốt. Đối với ví dụ của chúng ta, Gemma 4 hỗ trợ tất cả các tính năng đó, vì vậy hãy bật tất cả.

TomoriBot sẽ xác thực kết nối khi bạn lưu. Nếu báo lỗi không thể kết nối tới endpoint, nguyên nhân
thông thường là do không khớp giữa `localhost`/Docker hoặc thiếu/thừa `/v1` (xem
[các lưu ý](#luu-y-va-cac-van-de-thuong-gap)).

Việc thêm model sẽ tự động đặt nó làm model `text` đang hoạt động. Hãy bắt đầu trò chuyện để trải nghiệm. Nếu
vì lý do nào đó model chưa hoạt động, hãy chạy `/config` > Models > Switch Models và chọn model mới đăng ký của bạn.

Việc đăng ký không bao giờ làm thay đổi bất kỳ model nào khác ngoài `text`. Nếu bạn đã đánh dấu Image Understanding
để endpoint này hoạt động như một trình hỗ trợ thị giác cho model trò chuyện không có khả năng nhìn ảnh, hãy chọn nó
một cách rõ ràng bằng `/config` > Models > Switch Models; mọi endpoint text bạn đã đăng ký với nút bật đó đều xuất hiện
ở đó. Lưu ý rằng model thị giác chỉ được hỏi ý kiến khi model trò chuyện không thể nhìn thấy hình ảnh, vì vậy
việc đặt model thị giác phía sau một model trò chuyện có sẵn khả năng nhìn ảnh sẽ không có tác dụng cho đến khi bạn chuyển đổi.

## 3. (Tùy chọn) Vector nhúng cục bộ cho RAG

Chọn endpoint đã lưu và sử dụng menu dropdown model để thêm một model Embedding (ví dụ
`ollama pull nomic-embed-text`, Model Name `nomic-embed-text:latest`). Các tính năng RAG cũng yêu cầu
pgvector được cài đặt trong Postgres. Bạn có thể xem hướng dẫn [cài đặt thủ công](/vi/self-hosting/manual-setup/) tại đây.

## Các máy chủ khác

Tất cả các máy chủ này đều sử dụng cùng một quy trình, chỉ có URL và một vài lưu ý là thay đổi.

### KoboldCPP

- Khởi động với chế độ tương thích OpenAI được bật (tích hợp sẵn). Mặc định: `http://127.0.0.1:5001/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Hỗ trợ `Tùy chỉnh cửa sổ ngữ cảnh` tương tự như Ollama.
- Nạp các model GGUF; Model Name là bất kỳ tên nào mà model đã nạp báo cáo (thường là tên
  tệp không có phần mở rộng), kiểm tra phản hồi từ `/v1/models` của KoboldCPP.

### llama.cpp (`llama-server`)

- Xây dựng hoặc cài đặt [llama.cpp](https://github.com/ggml-org/llama.cpp), sau đó phục vụ tệp GGUF bằng
  máy chủ tương thích OpenAI đi kèm:
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8080/v1`.
- Đặt kích thước cửa sổ ngữ cảnh khi khởi chạy bằng `-c`, vì tùy chọn `Tùy chỉnh cửa sổ ngữ cảnh` trong modal chỉ
  dành cho Ollama/KoboldCPP và không có tác dụng ở đây.
- Model Name là bất kỳ tên nào mà `/v1/models` báo cáo; bạn có thể đặt tên gọn gàng bằng `--alias my-model`.
- Nếu bạn khởi động với `--api-key`, hãy nhập khóa đó vào `auth_token`.

### LM Studio

- Trong LM Studio, khởi động Local Server (thẻ Developer). Mặc định: `http://127.0.0.1:1234/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- Model Name là định danh mà LM Studio hiển thị cho model đã nạp.

### vLLM

- Phục vụ bằng máy chủ tương thích OpenAI: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- Nếu bạn khởi chạy vLLM với `--api-key`, hãy nhập khóa đó vào `auth_token`.
- Model Name là đường dẫn/tên model được phục vụ (khớp với `/v1/models`).

### LiteLLM (proxy cho nhiều backend)

- Chạy proxy LiteLLM; mặc định: `http://127.0.0.1:4000/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- Model Name là bí danh model bạn đã định nghĩa trong cấu hình của LiteLLM.
- Nếu proxy yêu cầu khóa chính, hãy đặt khóa đó trong `auth_token`.

### ChatMock (tài khoản ChatGPT / Codex CLI)

Có hướng dẫn chuyên biệt riêng do giải pháp thay thế prompt system:
[Thiết lập: ChatMock](/vi/self-hosting/local-endpoints/setup-chatmock/).

## Chọn model từ Hugging Face

Bên cạnh thư viện tuyển chọn của Ollama, [Hugging Face](https://huggingface.co) lưu trữ hàng nghìn
model cộng đồng. KoboldCPP, llama.cpp và LM Studio đều có thể nạp định dạng GGUF, là gói
tệp đơn lẻ mà bạn tải về và trỏ máy chủ vào đó.

1. Tìm tệp GGUF. Tìm kiếm trên Hugging Face tên model của bạn kèm từ khóa "GGUF", các tác giả lượng hóa cộng đồng như
   [bartowski](https://huggingface.co/bartowski) thường xuất bản các bản dựng GGUF cho hầu hết các model phổ biến
   ngay sau khi phát hành. Hãy ưu tiên biến thể instruct/chat (tên kết thúc bằng `-Instruct` hoặc
   `-Chat`); các model nền tảng không thể duy trì cuộc trò chuyện.
2. Chọn mức lượng hóa phù hợp với VRAM của bạn. Một kho lưu trữ sẽ liệt kê cùng một model ở nhiều mức lượng hóa, và
   dung lượng tệp ≈ lượng VRAM nó cần (cộng thêm ~1-2 GB cho ngữ cảnh, cùng quy tắc như
   [bảng kích thước](#toi-nen-tai-kich-thuoc-nao) ở trên). Tải tệp `.gguf` đơn lẻ cho lựa chọn của bạn.
3. Nạp model. Khởi động KoboldCPP hoặc `llama-server` với tệp đó (xem
   [Các máy chủ khác](#cac-may-chu-khac)), sau đó đăng ký endpoint trong Discord như bình thường.

:::tip[Nên chọn mức lượng hóa nào? Q4 hoặc Q5 là điểm cân bằng lý tưởng]
Lượng hóa (Quantization) lưu trữ từng trọng số bằng ít bit hơn để thu nhỏ model, với mức đánh đổi chất lượng rất nhỏ.
Mã trong các tên như `Q4_K_M` / `Q5_K_M` biểu thị số bit trên mỗi trọng số: **4-bit (Q4) hoặc 5-bit (Q5)
thường là điểm cân bằng lý tưởng** khi giữ lại hầu hết chất lượng với kích thước chỉ bằng khoảng một nửa so với 8-bit. Dưới 4-bit
sẽ giảm sút chất lượng nhanh chóng. Và với một mức ngân sách VRAM cố định, một **model lớn hơn ở mức Q4 thường đánh bại
model nhỏ hơn ở mức Q8**.
:::

## Lưu ý và các vấn đề thường gặp

- Mỗi nhãn chỉ tương ứng với một mục endpoint. Để đăng ký nhiều model dùng chung một máy chủ, hãy chọn
  endpoint đã lưu và sử dụng lại menu dropdown model của nó. Sử dụng các nhãn riêng biệt cho các máy chủ
  hoặc giao thức API thực sự khác nhau.
- Model Name là định danh API. Đây là chuỗi chính xác được gửi đến máy chủ. Điền sai tên này là nguyên nhân
  phổ biến nhất dẫn đến tình trạng "kết nối được nhưng phản hồi thất bại".
- Chạy TomoriBot trong Docker? `localhost` bên trong container không phải là máy chủ lưu trữ của bạn. Hãy sử dụng
  `http://host.docker.internal:<port>` (Windows/macOS) hoặc IP mạng LAN của máy chủ, và liên kết
  máy chủ model với `0.0.0.0`.
