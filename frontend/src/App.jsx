import { useState } from "react";

// In production (Render), frontend is served by the backend on the same origin.
// In development, Vite proxy handles /api requests to localhost:3001.
const API_URL = "/api/lookup";

function ProfileCard({ profile }) {
  return (
    <div className="result-card">
      <div className="result-rows">
        {profile.name && (
          <div className="result-row">
            <span className="result-label">Name</span>
            <span className="result-value">{profile.name}</span>
          </div>
        )}
        {profile.company && (
          <div className="result-row">
            <span className="result-label">Current Company</span>
            <span className="result-value company-value">{profile.company}</span>
          </div>
        )}
        {profile.title && (
          <div className="result-row">
            <span className="result-label">Role</span>
            <span className="result-value">{profile.title}</span>
          </div>
        )}
        {profile.linkedin_url && (
          <div className="result-row">
            <span className="result-label">LinkedIn</span>
            <a
              className="result-link"
              href={profile.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {profile.linkedin_url}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [matchedProfiles, setMatchedProfiles] = useState([]);
  const [companyName, setCompanyName] = useState(null);
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [searchedName, setSearchedName] = useState("");
  const [sources, setSources] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMatchedProfiles([]);
    setCompanyName(null);
    setCompanyEmployees([]);
    setSearchedName("");
    setSources(null);

    if (!email.trim()) {
      setError("Please enter an email address.");
      return;
    }

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const body = { email: email.trim() };
      if (name.trim()) body.name = name.trim();
      if (country.trim()) body.country = country.trim();

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || "No results found for this email.");
      } else {
        // Handle both formats: matched_profiles (array) or matched_profile (single object)
        let profiles = data.matched_profiles || [];
        if (profiles.length === 0 && data.matched_profile) {
          profiles = [data.matched_profile];
        }
        // Also handle old format: other_matches from previous backend version
        if (data.other_matches && data.other_matches.length > 0) {
          const existingUrls = new Set(profiles.map((p) => p.linkedin_url));
          for (const om of data.other_matches) {
            if (!existingUrls.has(om.linkedin_url)) {
              profiles.push(om);
              existingUrls.add(om.linkedin_url);
            }
          }
        }

        setMatchedProfiles(profiles);
        setCompanyName(data.company_name || null);
        setCompanyEmployees(data.company_employees || []);
        setSearchedName(data.searched_name || "");
        setSources(data.sources_checked || null);
      }
    } catch (err) {
      setError("Could not connect to the server. Make sure the backend is running on port 3001.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="container">
        {/* Header */}
        <div className="header">
          <div className="logo">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
              <rect x="2" y="9" width="4" height="12" />
              <circle cx="4" cy="4" r="2" />
            </svg>
          </div>
          <h1>Email to LinkedIn Lookup</h1>
          <p className="subtitle">
            Enter a personal email address to find matching LinkedIn profiles.
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="search-form-vertical">
          <div className="input-group">
            <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address (required)"
              className="email-input"
              disabled={loading}
            />
          </div>

          {!showExtras ? (
            <button
              type="button"
              className="add-name-link"
              onClick={() => setShowExtras(true)}
            >
              + Add name, country for better accuracy
            </button>
          ) : (
            <div className="extra-fields">
              <div className="input-group">
                <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name (e.g. John Smith)"
                  className="email-input"
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div className="input-group">
                <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="10" r="3" />
                  <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z" />
                </svg>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Country (e.g. United States, India)"
                  className="email-input"
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <button type="submit" className="lookup-btn" disabled={loading}>
            {loading ? (
              <span className="spinner" />
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Find LinkedIn Profile
              </>
            )}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div className="error-card">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Searched name hint */}
        {matchedProfiles.length > 0 && searchedName && (
          <div className="result-meta">
            {sources && (
              <div className="sources-info">
                Sources: {[
                  sources.apollo && "Apollo",
                  sources.github && "GitHub",
                  sources.gravatar && "Gravatar",
                  "Google"
                ].filter(Boolean).join(", ")}
              </div>
            )}
            <p className="searched-hint">
              Searching for: <strong>{searchedName}</strong>
            </p>
          </div>
        )}

        {/* Results */}
        {matchedProfiles.length > 0 && (
          <div className="all-matches">
            {/* Matched Profiles */}
            <div className="main-match-section">
              <h3 className="section-title main-match-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {matchedProfiles.length === 1 ? "Matched Profile" : `Matched Profiles (${matchedProfiles.length})`}
              </h3>
              {matchedProfiles.map((profile, i) => (
                <ProfileCard key={i} profile={profile} />
              ))}
            </div>

            {/* People working at the same company */}
            {companyEmployees.length > 0 && companyName && (
              <div className="company-group">
                <h3 className="section-title company-group-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  People currently working at {companyName}
                </h3>
                {companyEmployees.map((emp, i) => (
                  <ProfileCard key={i} profile={emp} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
