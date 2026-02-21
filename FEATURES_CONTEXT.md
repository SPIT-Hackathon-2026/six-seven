# Collaborative Offline Git App - Feature List

This document outlines all the major features we have built into the project so far. 

## 🔌 1. True Offline Git Core
Using `isomorphic-git` and `react-native-fs`, the app functions as a complete localized version control system that runs 100% on the mobile device's processor without needing internet access.
- **Repository Management:** Initialize new repos, clone from GitHub, delete repos.
- **File Inspector:** View the directory tree, read files, and see a unified diff syntax-highlighted code editor.
- **Branching System:** Create, delete, list, and instantly checkout branches.
- **Committing:** Stage all files (or unstage), write commit messages, and commit straight to the local `.git` directory.
- **Merge & Conflict Resolution:** Perform local branching merges. Includes a custom UI to detect 3-way conflicts and manually resolve them (Accept Ours, Accept Theirs, or Edit file directly).
- **History & Reflog:** Full interactive commit history, timeago timestamps, and the ability to perform `reset --hard` via reflog if mistakes are made.
- **Stashing:** Temporarily `stash` working directory changes, and `stash pop` them later.
- **Tagging:** Create and delete lightweight tags on specific commits.

## 🤝 2. Real-Time Collaborative "Repo Chat"
A WhatsApp-style chat room specifically scoped to individual repositories, allowing developers to communicate while offline or online.
- **Node.js + PostgreSQL Backend:** Secure, persistent relational database storing all repo conversations.
- **Socket.io Real-Time Engine:** Instant, sub-second message delivery.
- **Offline Sync Queueing:** Users can type and "send" messages while disconnected. Messages enter an AsyncStorage queue with a 🕒 "pending" icon, and automatically flush to the central server the second Wi-Fi is restored.
- **Device Fingerprinting:** Uses Expo `installationId` to distinctly render remote messages (left align) vs local messages (right align), preventing identical Git Author names from breaking the UI.

## 🤖 3. AI Integrations (Groq Llama-3)
- **AI Commit Generation:** Reads the `diffSummary` of staged modifications and uses `aiService.js` to automatically generate semantic, conventional commit messages.
- **AI Code Review:** Scans the diff of uncommitted changes and suggests bug fixes, optimizations, or security improvements before the user commits.
- **Natural Language Base (Prepared):** Foundation laid for AI natural language search via `nlSearchService.js` to query repositories via natural language.

## 📶 4. Network Resiliency & Syncing
- **Smart Remote Management:** Add, remove, and list `origin` remotes.
- **Standard Git Sync:** Fetch, Pull (with auto-merge), and Push to GitHub using Personal Access Tokens (PAT).
- **Offline Operations:** The app uses `@react-native-community/netinfo` to track network state. It actively disables "Push" buttons if internet is lost, and warns the user when functions are limited.

## 🔗 5. Peer-to-Peer Transfer & Sharing
- **QR Code Sharing:** The app encodes patches and repository states into QR codes for direct visual transfer between devices.
- **Local File System Export:** Zip export the entire `.git` tree or raw project files to the Android Downloads folder via Expo File System to AirDrop / Bluetooth transfer to a laptop.

## 🎨 6. UI / UX Design
- **Dark Mode Native:** TailwindCSS (NativeWind) driven deep dark mode styling mimicking GitHub's UI.
- **Visual Commit Graph:** Renders a horizontal, color-coded node graph of the commit history to visually understand branch divergence.
- **Iconography:** Extensive use of `lucide-react-native` for intuitive navigation.
- **Code Syntax Highlighting:** A custom React Native syntax parser component.
