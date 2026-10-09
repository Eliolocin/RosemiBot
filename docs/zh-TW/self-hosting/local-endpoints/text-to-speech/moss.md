---
title: "MOSS-TTS"
---

使用 [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) 透過統一語音端點在本地評估語音克隆和自然語言語音設計。

使用`servers/tts/moss/server.py`，TomoriBot動態路由合成請求：當人格提供`ref_audio`時，它會載入複製模型，並在給出自然語言`instruct`指導時切換到MOSS-VoiceGenerator。GPU記憶體中一次僅儲存一個模型，以便在16 GB VRAM預算內運作。

預設克隆模型是 [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B)，選擇作為16 GB GPU的實用基準。[MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) 是8B旗艦替代品，在BF16時需要更多VRAM。語音設計使用[MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)（約1.7B）。克隆和語音設計之間的交換會導致模型載入延遲。

## 設定

使用Python 3.12和與CUDA 12.8相容的驅動程式從TomoriBot儲存庫根執行命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux或WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

在啟動伺服器之前，預取指令會將複製模型、VoiceGenerator和音訊標記器下載到Hugging Face快取中。如果磁碟空間有限，請將`HF_HOME`設定為更大的分割區。若要僅下載一種模型，請傳遞`--mode clone`或`--mode voice-design`。

預設端點是`http://127.0.0.1:8018`。運行`bun run launch --moss`以與TomoriBot一起啟動伺服器。自動模式從本機快取預熱克隆模型。將`MOSS_TTS_WARM_MODE=voice-design`設定為預熱VoiceGenerator，或將`MOSS_TTS_WARM_MODE=none`設定為延遲初始化。檢查`GET /health`是否有活動的`warm_mode`、`active_mode`和`model_id`。包裝器使用Hugging Face `trust_remote_code=True`，因此在更新之前請檢查上游代碼。

## 在TomoriBot中註冊

在`/providers`中，選擇`Add New Custom Endpoint`，將API相容性設定為`tts-clone`，並使用端點URL `http://127.0.0.1:8018`。新增一個語音模型，其中`語音來源模式`設定為`自動`，`Script Markup`設定為`純文字`。在`/config` > `模型` > `切換模型`下啟動它。

對於語音克隆，請在`/config` > `模型` > `TTS參數與語音`下上傳乾淨的參考剪輯，並將其指派到人格 > `語音`下。較短、乾淨的音訊剪輯可產生最一致的結果。對於語音設計，請在人格 > `語音`下儲存自然語言描述。請注意，MOSS-VoiceGenerator是為英文和中文設計的。雖然4B克隆模型支援日語，但顯式語言標籤提高了合成清晰度。

TomoriBot的克隆適配器不會自動發送語言標籤。對於單一語言使用，請在啟動伺服器之前設定`MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（或`繁體中文`、`Chinese`等）。手動`/synthesize`呼叫可以直接通過`language`。

伺服器讀取自己的shell環境；機器人`.env`中的設定不適用於獨立啟動的Python終端。

若要在高記憶體硬體上執行8B模型，請在預取之前設定`MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE`和`MOSS_TTS_MAX_NEW_TOKENS`可在`.env.optional.example`中設定。如果模型交換或CPU執行導致逾時，請增加TomoriBot中的`TTS_SYNTHESIZE_TIMEOUT_MS`。
