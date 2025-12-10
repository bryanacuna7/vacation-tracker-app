# 🏖️ Vacation Management System

<div align="center">

![Status](https://img.shields.io/badge/Status-Live_Demo-success)
![Tech](https://img.shields.io/badge/Stack-React_|_Google_Apps_Script_|_Google_Sheets-0071e3)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

**A modern, full-stack vacation request system that eliminates manual processes and enforces business rules automatically.**

[View Live Demo](https://bryanacuna7.github.io/vacation-tracker-app) • [Report Bug](https://github.com/bryanacuna7/vacation-tracker-app/issues) • [Request Feature](https://github.com/bryanacuna7/vacation-tracker-app/issues)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Live Demo](#-live-demo)
- [Tech Stack](#️-tech-stack)
- [Architecture](#️-architecture)
- [Screenshots](#-screenshots)
- [Getting Started](#-getting-started)
- [Business Logic](#-business-logic)
- [Roadmap](#-roadmap)
- [Author](#-author)
- [License](#-license)

---

## 🎯 Overview

A **production-ready full-stack application** designed to automate corporate vacation management from end to end. Built to replace chaotic email chains and scattered spreadsheets, this system centralizes all vacation data, enforces company policies automatically, and provides real-time insights for managers.

### The Problem

- ❌ Manual email approval chains causing delays
- ❌ Lost requests and miscommunication
- ❌ No visibility into team coverage
- ❌ Manual calendar updates prone to errors
- ❌ Difficult to enforce blackout dates and policies

### The Solution

✅ **Automated workflow** from request to calendar event  
✅ **Real-time validation** of business rules  
✅ **Centralized data** in Google Sheets (no database setup)  
✅ **Role-based dashboards** for employees and managers  
✅ **Instant notifications** via email for all status changes  

---

## 🌟 Key Features

### 👤 For Employees

<table>
<tr>
<td width="50%">

**📅 Interactive Calendar**
- Visual date range selection
- See approved team vacations
- Real-time balance display
- Mobile-responsive design

</td>
<td width="50%">

**📊 Request Management**
- Submit new requests instantly
- Track request status (Pending/Approved/Rejected)
- Edit or cancel pending requests
- View complete history

</td>
</tr>
</table>

### 👔 For Managers

<table>
<tr>
<td width="50%">

**✅ Approval Dashboard**
- One-click approve/reject
- See conflict warnings automatically
- View team coverage calendar
- Bulk actions support

</td>
<td width="50%">

**📈 Analytics & Insights**
- Team vacation statistics
- Usage patterns by department
- Balance tracking across team
- Export capabilities

</td>
</tr>
</table>

---

## 🎬 Live Demo

**🔗 [Launch Demo Application](https://bryanacuna7.github.io/vacation-tracker-app)**

> **💡 Note:** The live demo runs in **mock mode** using local state to simulate the full experience. The production version connects to Google Workspace (Sheets, Calendar, Gmail) which requires proper authentication and setup.

**Demo Credentials:**
- **Employee view:** Default view (13 days remaining)
- **Manager view:** Toggle `isManager: true` in demo data (line 1175)

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose | Details |
|:-----------|:--------|:--------|
| **React 18** | UI Framework | Hooks-based SPA with virtual DOM |
| **CSS3** | Styling | Custom properties, Grid, Flexbox |
| **Boxicons** | Icons | Lightweight icon library |
| **SweetAlert2** | Modals | Beautiful, accessible alerts |

### Backend
| Technology | Purpose | Details |
|:-----------|:--------|:--------|
| **Google Apps Script** | Server Logic | V8 Runtime, Serverless |
| **Google Sheets** | Database | Relational data with query support |
| **Gmail API** | Notifications | HTML email templates |
| **Calendar API** | Event Management | Automatic event creation |
| **LockService** | Concurrency | Mutex for race condition prevention |

---

## 🏗️ Architecture

The application follows a **Serverless MVC** pattern optimized for Google Workspace:

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Calendar  │  │  Dashboard │  │   Forms    │            │
│  │ Component  │  │ Component  │  │ Component  │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│         │                │                │                  │
│         └────────────────┴────────────────┘                  │
│                          │                                   │
│                   React State                                │
└──────────────────────────┼──────────────────────────────────┘
                           │
                  google.script.run (RPC)
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   CONTROLLER LAYER                           │
│  ┌────────────────────────────────────────────────────┐     │
│  │  API Endpoints (Google Apps Script Functions)      │     │
│  │  - getDashboardData()                              │     │
│  │  - apiCreateRequest()                              │     │
│  │  - apiProcessRequest() [Manager]                   │     │
│  └────────────────────────────────────────────────────┘     │
│                          │                                   │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     SERVICE LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Business   │  │  Validation  │  │     Lock     │      │
│  │     Logic    │  │    Rules     │  │   Service    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                          │                                   │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      DATA LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Google    │  │    Gmail     │  │   Calendar   │      │
│  │    Sheets    │  │     API      │  │     API      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Serverless Architecture:** No infrastructure to maintain, scales automatically
2. **Google Sheets as DB:** Familiar to HR, easy auditing, built-in backup
3. **React without build tools:** Single HTML file deployment, no bundler needed
4. **Optimistic UI updates:** Instant feedback with server reconciliation
5. **LockService for concurrency:** Prevents double-booking race conditions

---

## 📸 Screenshots

### Employee Dashboard
*Clean interface showing available balance and interactive calendar for date selection*

### Manager Approval View
*Streamlined approval dashboard with conflict detection and team coverage insights*

### Request History
*Complete audit trail of all requests with status and timestamps*

---

## 🚀 Getting Started

### Prerequisites

- Google Workspace account (for production deployment)
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Installation

#### Option 1: View Demo Only
```bash
# Simply open the live demo
https://bryanacuna7.github.io/vacation-tracker-app
```

#### Option 2: Deploy to Your Organization

1. **Clone the repository**
```bash
git clone https://github.com/bryanacuna7/vacation-tracker-app.git
cd vacation-tracker-app
```

2. **Set up Google Apps Script project**
   - Create a new Google Sheet for your organization
   - Open Tools → Script editor
   - Copy the `.gs` backend code
   - Set up the sheet structure (see documentation)

3. **Configure the frontend**
   - Update `index.html` with your deployment URL
   - Set `IS_DEV = false` for production
   - Deploy as a web app from Apps Script

4. **Set permissions**
   - Grant necessary OAuth scopes
   - Configure service account for Calendar/Gmail APIs

---

## 🧠 Business Logic

The system automatically enforces several business rules:

### Validation Rules

| Rule | Description | Action |
|:-----|:------------|:-------|
| **Blackout Dates** | Company-wide blocked periods | ❌ Reject request |
| **Team Coverage** | Minimum team members present | ⚠️ Warn manager |
| **Balance Check** | Sufficient days available | ❌ Reject request |
| **Weekend Exclusion** | Only count business days | ✅ Auto-calculate |
| **Overlap Detection** | Multiple requests same dates | ⚠️ Flag for review |

### Workflow States

```
[Submitted] → [Pending]
                  ↓
         ┌────────┴────────┐
         ↓                 ↓
    [Approved]        [Rejected]
         ↓                 ↓
  ✓ Calendar Event   ✗ Notification
```

---

## 💡 Lessons Learned

### Technical Challenges
- **Concurrency:** Implemented LockService to handle simultaneous requests
- **State Management:** Balanced between server truth and optimistic updates
- **Email HTML:** Cross-client email rendering required extensive testing

### Design Decisions
- **Why Google Sheets?** Familiar to HR teams, no database setup, built-in audit trail
- **Why Apps Script?** Zero infrastructure cost, perfect for small-to-medium teams
- **Why single HTML file?** Easier deployment, no build step, works everywhere

---

## 👨‍💻 Author

**Bryan Acuña**  

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0077B5?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/bryan-acu%C3%B1a-as12b7/)
[![GitHub](https://img.shields.io/badge/GitHub-Follow-181717?style=for-the-badge&logo=github)](https://github.com/bryanacuna7)
[![Portfolio](https://img.shields.io/badge/Portfolio-Visit-FF5722?style=for-the-badge&logo=google-chrome&logoColor=white)](https://bryanacuna7.github.io)

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Design inspiration: [Apple](https://www.apple.com) & [Stripe](https://stripe.com)
- Icons: [Boxicons](https://boxicons.com)
- Alerts: [SweetAlert2](https://sweetalert2.github.io)
- Font: [Inter](https://rsms.me/inter/) by Rasmus Andersson

---

<div align="center">

**⭐ If this project helped you, please consider giving it a star!**

</div>
