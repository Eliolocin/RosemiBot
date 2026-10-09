---
title: "WhisperXの文字起こし"
sidebar:
  order: 1
---

バンドルされている [WhisperX](https://github.com/m-bain/whisperX) サーバーを使用して、TomoriBotのローカルで正確な音声認識をセットアップします。WhisperXは、単語レベルのアライメントによる高速音声転写を提供します。

## セットアップ

TomoriBotリポジトリルートから次のコマンドを実行します。

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

TomoriBotがWhisperXを使用している間は、そのターミナルを開いたままにしてください。デフォルトのエンドポイントURLは`http://127.0.0.1:8021`です。

## TomoriBotへの登録

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、文字起こしのAPI互換性を使用します。

- API互換性：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

接続を保存したら、それを選択し、モデルのドロップダウンから`large-v3`（または`WHISPERX_MODEL`に設定されている値）を文字起こしモデルとして追加します。

エンドポイントの登録とモデルのセットアップには`/providers`を使用してください。その後、`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化します。

## トランスクリプトを使用する

登録後、TomoriBotはバックグラウンドで音声添付ファイルを文字起こしし、テキストをチャットコンテキストに追加します。トランスクリプトをチャットに視覚的に投稿したい場合にのみ、「`/config`」>「エンジン」>「通知」を使用します。
