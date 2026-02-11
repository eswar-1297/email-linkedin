# Email to LinkedIn Lookup Tool

A simple React + Node.js tool that takes a personal email address and returns the associated LinkedIn profile URL and current workplace, powered by the People Data Labs API.

## Prerequisites

- **Node.js** v18+ installed
- **People Data Labs account** (free, 100 credits/month) for the API key

## Setup

### 1. Get a People Data Labs API Key

1. Sign up at [peopledatalabs.com](https://www.peopledatalabs.com) (free, no credit card required)
2. Go to your API keys page at [dashboard.peopledatalabs.com/api-keys](https://dashboard.peopledatalabs.com/api-keys)
3. Copy your API key

### 2. Configure the Backend

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and replace `your_api_key_here` with your actual API key:

```
PDL_API_KEY=your_actual_key_here
```

### 3. Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 4. Run the Application

Open two terminal windows:

**Terminal 1 — Backend (port 3001):**

```bash
cd backend
npm start
```

**Terminal 2 — Frontend (port 5173):**

```bash
cd frontend
npm run dev
```

### 5. Use the Tool

Open your browser and go to **http://localhost:5173**. Enter a personal email address and click **Lookup** to see the LinkedIn profile and current company.

## Project Structure

```
email-v2/
  backend/
    package.json        # Backend dependencies
    server.js           # Express API server
    .env.example        # Environment variable template
    .env                # Your actual API key (not committed)
  frontend/
    package.json        # Frontend dependencies
    vite.config.js      # Vite configuration
    index.html          # Entry HTML
    src/
      App.jsx           # Main React component
      App.css           # Styles
      main.jsx          # React entry point
  README.md             # This file
```

## API Details

The backend exposes a single endpoint:

**POST** `/api/lookup`

Request body:
```json
{ "email": "john@gmail.com" }
```

Response:
```json
{
  "success": true,
  "data": {
    "linkedin_url": "https://linkedin.com/in/johndoe",
    "name": "John Doe",
    "title": "Software Engineer",
    "company": "Acme Inc."
  }
}
```

## Notes

- The free People Data Labs plan includes 100 API calls per month.
- Each email lookup uses 1 credit.
- Not all emails will return results — it depends on whether PDL has data for that email.
- Personal emails (Gmail, Yahoo, Outlook, etc.) and work emails are both supported.
