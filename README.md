<div align="center">

<img src="docs/nexus-concept.jpg" width="320" alt="Nexus character"/>

# NEXUS

**Study beyond limits.** A free AI study buddy you can talk to in Tamil and English, running on your own laptop.

![Free](https://img.shields.io/badge/cost-free-16a34a?style=flat-square) ![Local AI](https://img.shields.io/badge/AI-local_Ollama-0ea5e9?style=flat-square) ![Languages](https://img.shields.io/badge/languages-Tamil_%2B_English-f59e0b?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)

</div>

---

## What it is

Nexus is a 2D character that lives on your desktop and talks with you while you study. It listens, thinks, answers out loud and reacts on screen. The AI model runs locally through [Ollama](https://ollama.com), so there are no subscriptions and no cost.

## Features

- **Voice chat in Tamil and English.** Talk with the mic or type. Replies stream in and are spoken back sentence by sentence.
- **A character that reacts.** Listening, thinking and speaking each have their own look, with a live waveform in a dark HUD interface.
- **Your model, your choice.** Pick any model you have pulled in Ollama from the panel. Default is `gemma3`.
- **Private by default.** Chats stay on your laptop.
- **Desktop overlay.** An Electron overlay in [`overlay/`](overlay/) puts the character on your screen with hands-free voice, memory and permission-gated tools.
- **Built for a modest laptop.** Aimed at 6 GB VRAM and 16 GB RAM.

## Roadmap

Your own notes with citations, reading your screen on request, camera and phone support.

## Good to know

Voice input uses the browser's speech recognition (Chrome or Edge). Small local models can make mistakes, especially in Tamil, so check important answers against your notes. The portrait is an original AI-generated illustration.

## Get it

Clone or download this repo and double-click `run.bat` on Windows. Ollama is required. The overlay setup is in [`overlay/README.md`](overlay/README.md).

## Built by

[Subash M K](https://github.com/subasmk). MIT licensed.
