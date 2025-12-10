# ✈️ Vacation Management System

![Status](https://img.shields.io/badge/Status-Live_Demo-success)
![Tech](https://img.shields.io/badge/Stack-Google_Apps_Script_|_React_|_Google_Sheets-0071e3)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

## 📌 Project Overview
A comprehensive **Full-Stack web application** designed to automate and streamline the vacation request process for corporate teams. 

Originally developed to replace manual email chains and disparate spreadsheets, this tool centralizes data, enforces business rules (blackout dates, overlap checks), and provides real-time visualization for managers.

**🔗 [View Live Demo](https://bryanacuna7.github.io/vacation-tracker-app)**
> **Note:** The live demo runs in **"Mock Mode"** using React state to simulate the experience, as the backend logic requires a specific Google Workspace environment to execute.

---

## 🚀 Key Features

### 🖥️ Frontend (User Experience)
* **Interactive Calendar:** Built with **React**, featuring custom range selection and visual status indicators.
* **Responsive Design:** Fully responsive UI (CSS Grid/Flexbox) that works on desktop and mobile devices.
* **Role-Based Views:**
    * **Employees:** Can request dates, view history, and check their remaining balance.
    * **Managers:** Access to a "Team Overview" and an approval dashboard.

### ⚙️ Backend (Automation & Logic)
* **Business Logic Validation:** * Prevents requests during blackout periods.
    * Detects coverage conflicts (overlapping team members).
    * Enforces balance limits before approval.
* **Automated Workflow:**
    * **Google Calendar:** Automatically creates events upon approval.
    * **Email Notifications:** Sends HTML-formatted emails for status updates (Received, Approved, Rejected).
    * **Database:** Uses Google Sheets as a relational database for easy auditing by HR.
* **Concurrency Control:** Implements `LockService` (Mutex) to prevent race conditions during simultaneous requests.

---

## 🛠️ Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | React 18 | Single Page Application (SPA) architecture. |
| **Styling** | CSS3 | Custom properties (variables) for theming. |
| **Backend** | Google Apps Script | Serverless JavaScript (V8 Engine). |
| **Database** | Google Sheets | Low-code database solution. |
| **API** | GAS Services | `GmailApp`, `CalendarApp`, `LockService`. |

---

## 🏗️ Architecture

The application follows a **Serverless MVC** pattern:

1.  **Client:** The browser renders the React app. It detects if it's running inside Google (`google.script.run`) or on the open web (`IS_DEV` flag).
2.  **Controller:** `google.script.run` acts as the asynchronous bridge, sending JSON payloads to the backend.
3.  **Server:** The `.gs` script handles the request, validates logic, and updates the "Database" (Sheets).
4.  **Services:** The server triggers external actions (Emails, Calendar events) based on the transaction result.

---

## 📸 Usage

### 1. Employee Dashboard
*Visualizes available balance and allows date selection via the calendar.*

### 2. Manager Approval
*Managers can see pending requests with conflict warnings (e.g., "Overlap with John Doe").*

---

## 👨‍💻 Author

**Bryan Acuña** *Data Analyst & Automation Specialist* [LinkedIn](https://www.linkedin.com/in/bryan-acu%C3%B1a-as12b7/)

---
*This project is open-source under the MIT License.*
