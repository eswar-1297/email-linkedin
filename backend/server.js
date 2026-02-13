require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files in production
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(frontendDist));

// Validate email format
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Extract a probable name from an email address (last resort fallback)
function extractNameFromEmail(email) {
  const localPart = email.split("@")[0];
  let name = localPart.replace(/[._\-]/g, " ");
  name = name.replace(/[0-9]/g, "");
  name = name.replace(/\s+/g, " ").trim();

  // If the name is a single word (no separators in original email),
  // try to split it intelligently:
  // e.g. "pnarsunaidu" -> "p narsu naidu" won't work automatically,
  // but we can try: split single leading letter as initial,
  // and try camelCase-style splits
  if (!name.includes(" ") && name.length > 3) {
    // Try splitting a single leading letter as an initial (common in Indian names)
    // e.g. "pnarsunaidu" -> "p narsunaidu"
    const withInitial = name[0] + " " + name.slice(1);

    // Also try inserting spaces before uppercase letters (camelCase)
    const camelSplit = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

    // Return the version with the initial split (more common pattern)
    name = withInitial;
  }

  return name;
}

// Score how well a profile name matches the search name (0-100)
function getRelevanceScore(profileName, searchName) {
  if (!profileName || !searchName) return 0;

  const pName = profileName.toLowerCase().trim();
  const sName = searchName.toLowerCase().trim();

  // Exact match
  if (pName === sName) return 100;

  const pParts = pName.split(/\s+/);
  const sParts = sName.split(/\s+/);

  let score = 0;

  // Check how many name parts match
  for (const sp of sParts) {
    if (sp.length < 2) continue;
    for (const pp of pParts) {
      if (pp === sp) {
        score += 30; // exact word match
      } else if (pp.startsWith(sp) || sp.startsWith(pp)) {
        score += 20; // partial/prefix match
      } else if (pp.includes(sp) || sp.includes(pp)) {
        score += 10; // substring match
      }
    }
  }

  // Bonus if the profile name contains the full search name as substring
  if (pName.includes(sName) || sName.includes(pName)) {
    score += 25;
  }

  // Bonus for same number of name parts (e.g. both have first + last)
  if (pParts.length === sParts.length) {
    score += 5;
  }

  return Math.min(score, 100);
}

// Sort profiles by relevance to the search name, highest first
function rankProfiles(profiles, searchName) {
  return profiles
    .map((p) => ({ ...p, _score: getRelevanceScore(p.name, searchName) }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...p }) => p);
}

// Extract LinkedIn URL from a string (bio, website, etc.)
function findLinkedInUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+\/?/i);
  return match ? match[0] : null;
}

// ─── Source 0: Apollo.io People Match API (paid, tried first) ───
async function lookupApollo(email, name) {
  if (!process.env.APOLLO_API_KEY) return null;

  // Build request body — include name if provided for better matching
  const requestBody = { email };
  if (name) {
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      requestBody.first_name = nameParts[0];
      requestBody.last_name = nameParts.slice(1).join(" ");
    } else {
      requestBody.name = name.trim();
    }
  }

  console.log(`[Apollo] Searching for: ${email}${name ? ` (name: ${name})` : ""}`);
  try {
    const response = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[Apollo] Failed (${response.status}): ${errorText.substring(0, 150)}`);
      return null;
    }

    const data = await response.json();

    if (!data.person) {
      console.log("[Apollo] No person found");
      return null;
    }

    const person = data.person;
    const result = {
      source: "apollo",
      linkedin_url: person.linkedin_url || null,
      name: person.name || null,
      title: person.title || null,
      company: person.organization?.name || null,
    };

    console.log(
      `[Apollo] Found — Name: ${result.name}, Title: ${result.title}, Company: ${result.company}, LinkedIn: ${result.linkedin_url}`
    );
    return result;
  } catch (err) {
    console.error("[Apollo] Error:", err.message);
    return null;
  }
}

// ─── Source 1: GitHub API (free, no key needed, 60 req/hr) ───
async function lookupGitHub(email) {
  console.log(`[GitHub] Searching for: ${email}`);
  try {
    const searchRes = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "email-linkedin-lookup",
        },
      }
    );

    if (!searchRes.ok) {
      console.log(`[GitHub] Search failed: ${searchRes.status}`);
      return null;
    }

    const searchData = await searchRes.json();

    if (!searchData.items || searchData.items.length === 0) {
      console.log("[GitHub] No users found");
      return null;
    }

    const username = searchData.items[0].login;
    console.log(`[GitHub] Found user: ${username}`);

    const profileRes = await fetch(`https://api.github.com/users/${username}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "email-linkedin-lookup",
      },
    });

    if (!profileRes.ok) return null;

    const profile = await profileRes.json();

    const linkedinUrl =
      findLinkedInUrl(profile.bio) || findLinkedInUrl(profile.blog);

    const result = {
      source: "github",
      name: profile.name || null,
      company: profile.company?.replace(/^@/, "") || null,
      location: profile.location || null,
      linkedin_url: linkedinUrl || null,
      github_url: profile.html_url || null,
      bio: profile.bio || null,
    };

    console.log(
      `[GitHub] Found — Name: ${result.name}, Company: ${result.company}, LinkedIn: ${result.linkedin_url}`
    );
    return result;
  } catch (err) {
    console.error("[GitHub] Error:", err.message);
    return null;
  }
}

// ─── Source 2: Gravatar API (free, no key needed) ───
async function lookupGravatar(email) {
  console.log(`[Gravatar] Looking up: ${email}`);
  try {
    const hash = crypto
      .createHash("md5")
      .update(email.trim().toLowerCase())
      .digest("hex");

    const res = await fetch(`https://en.gravatar.com/${hash}.json`, {
      headers: { "User-Agent": "email-linkedin-lookup" },
    });

    if (!res.ok) {
      console.log(`[Gravatar] No profile found (${res.status})`);
      return null;
    }

    const data = await res.json();
    const entry = data?.entry?.[0];
    if (!entry) return null;

    let linkedinUrl = null;

    if (entry.accounts) {
      const linkedinAccount = entry.accounts.find(
        (a) => a.shortname === "linkedin"
      );
      if (linkedinAccount) {
        linkedinUrl = linkedinAccount.url;
      }
    }

    if (!linkedinUrl && entry.urls) {
      for (const u of entry.urls) {
        const found = findLinkedInUrl(u.value);
        if (found) {
          linkedinUrl = found;
          break;
        }
      }
    }

    const displayName =
      entry.displayName || entry.name?.formatted || null;

    const result = {
      source: "gravatar",
      name: displayName,
      company: entry.currentLocation || null,
      location: entry.currentLocation || null,
      linkedin_url: linkedinUrl,
      about: entry.aboutMe || null,
    };

    console.log(
      `[Gravatar] Found — Name: ${result.name}, LinkedIn: ${result.linkedin_url}`
    );
    return result;
  } catch (err) {
    console.error("[Gravatar] Error:", err.message);
    return null;
  }
}

// ─── Source 3: Google Custom Search (100/day free) ───
// useSiteFilter: true = add site:linkedin.com/in (precise), false = let Google autocorrect (fuzzy)
async function googleCustomSearch(query, useSiteFilter) {
  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CX) return null;

  const fullQuery = useSiteFilter ? `${query} site:linkedin.com/in` : `${query} linkedin`;
  console.log(`[Google] Searching: "${fullQuery}"${useSiteFilter ? " (site-filtered)" : " (fuzzy)"}`);
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CX}&q=${encodeURIComponent(fullQuery)}&num=10`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error("[Google] API error:", JSON.stringify(data.error));
      return null;
    }

    if (!data.items || data.items.length === 0) {
      console.log("[Google] No results");
      return null;
    }

    console.log(`[Google] Found ${data.items.length} raw result(s)`);

    // Filter for LinkedIn profile URLs only
    const results = data.items
      .filter((item) => item.link && /linkedin\.com\/in\//i.test(item.link))
      .map((item) => {
        const rawTitle = item.title || "";
        // Remove trailing "| LinkedIn" or "- LinkedIn" in any form
        const cleaned = rawTitle
          .replace(/\s*\|\s*LinkedIn\s*$/i, "")
          .replace(/\s*-\s*LinkedIn\s*$/i, "")
          .trim();
        // Split by " - " and filter out any leftover "LinkedIn" parts
        const parts = cleaned
          .split(" - ")
          .map((p) => p.trim())
          .filter((p) => p.toLowerCase() !== "linkedin" && p.length > 0);

        // LinkedIn title formats (title = CURRENT info only):
        //   1 part:  "Name"
        //   2 parts: "Name - Current Company"
        //   3 parts: "Name - Current Role - Current Company"
        //   4+ parts: "Name - Current Role - Current Company - Extra"
        let profileName = parts[0] || null;
        let jobTitle = null;
        let currentCompany = null;

        if (parts.length >= 3) {
          jobTitle = parts[1];
          currentCompany = parts[2];
        } else if (parts.length === 2) {
          // 2 parts: Name - Current Company (no role in title)
          currentCompany = parts[1];
        }

        // NOTE: Do NOT extract company from snippet — snippets contain
        // past employers too, which would mix current and former employees.
        // The LinkedIn page title ONLY shows current employment.

        let snippetText = item.snippet || "";

        return {
          linkedin_url: item.link,
          name: profileName,
          title: jobTitle,
          company: currentCompany,
          snippet: snippetText || null,
        };
      });

    console.log(`[Google] LinkedIn profiles found: ${results.length}`);
    return results.length > 0 ? results : null;
  } catch (err) {
    console.error("[Google] Error:", err.message);
    return null;
  }
}

// Search LinkedIn with precise filter first, then fuzzy fallback
async function searchLinkedIn(query) {
  // Try 1: Precise search with site: filter
  let results = await googleCustomSearch(query, true);
  if (results && results.length > 0) return results;

  // Try 2: Fuzzy search without site: filter (lets Google autocorrect work)
  results = await googleCustomSearch(query, false);
  return results;
}

// ─── Helper: Find matched person's LinkedIn profiles (returns ALL matches) ───
async function findMatchedProfiles(email, discoveredName, discoveredCompany, discoveredLocation) {
  let googleResults = null;

  // Try 1: Exact email
  googleResults = await searchLinkedIn(`"${email}"`);

  // Try 2: Name + Company + Location (most specific)
  if ((!googleResults || googleResults.length === 0) && discoveredCompany && discoveredLocation) {
    googleResults = await searchLinkedIn(`"${discoveredName}" "${discoveredCompany}" ${discoveredLocation}`);
  }

  // Try 3: Name + Company
  if ((!googleResults || googleResults.length === 0) && discoveredCompany) {
    googleResults = await searchLinkedIn(`"${discoveredName}" "${discoveredCompany}"`);
  }

  // Try 4: Name + Location/Country
  if ((!googleResults || googleResults.length === 0) && discoveredLocation) {
    googleResults = await searchLinkedIn(`"${discoveredName}" ${discoveredLocation}`);
  }

  // Try 5: Just the name (quoted)
  if (!googleResults || googleResults.length === 0) {
    googleResults = await searchLinkedIn(`"${discoveredName}"`);
  }

  // Try 5: Name without quotes (broadest)
  if (!googleResults || googleResults.length === 0) {
    googleResults = await searchLinkedIn(discoveredName);
  }

  if (!googleResults || googleResults.length === 0) return [];

  // Return ALL matches ranked by name relevance (best match first)
  return rankProfiles(googleResults, discoveredName);
}

// ─── Helper: Find current employees at a company ───
async function findCompanyEmployees(companyName, excludeUrl) {
  if (!companyName) return [];

  console.log(`[Company] Searching for current employees at: ${companyName}`);

  // Search for people currently at this company on LinkedIn
  const results = await googleCustomSearch(`"${companyName}" current`, true);

  if (!results || results.length === 0) return [];

  // Filter: only keep profiles whose CURRENT company (from title) matches
  // and exclude the matched person's own profile
  const employees = results.filter((p) => {
    if (excludeUrl && p.linkedin_url === excludeUrl) return false;
    if (!p.company) return false;
    return p.company.toLowerCase().includes(companyName.toLowerCase()) ||
           companyName.toLowerCase().includes(p.company.toLowerCase());
  });

  console.log(`[Company] Found ${employees.length} current employee(s) at ${companyName}`);
  return employees;
}

// ─── IT/Tech industry filter ───
const IT_KEYWORDS = [
  // Roles
  "software", "developer", "engineer", "programmer", "architect",
  "devops", "sre", "full stack", "fullstack", "frontend", "front-end",
  "backend", "back-end", "data scientist", "data engineer", "data analyst",
  "machine learning", "ml engineer", "ai ", "artificial intelligence",
  "cloud", "cybersecurity", "cyber security", "information security",
  "infosec", "security analyst", "security engineer", "penetration",
  "soc analyst", "network engineer", "network admin", "sysadmin",
  "system admin", "systems admin", "database admin", "dba",
  "qa engineer", "quality assurance", "test engineer", "automation engineer",
  "scrum master", "product manager", "product owner", "agile",
  "ux designer", "ui designer", "ux/ui", "ui/ux",
  "technical", "tech lead", "cto", "cio", "ciso", "vp of engineering",
  "it manager", "it director", "it specialist", "it consultant",
  "it support", "help desk", "desktop support", "solutions architect",
  "web developer", "mobile developer", "ios developer", "android developer",
  // Technologies
  "python", "java", "javascript", "typescript", "react", "angular", "vue",
  "node.js", "nodejs", ".net", "c#", "c++", "ruby", "golang", "rust",
  "aws", "azure", "gcp", "google cloud", "kubernetes", "docker",
  "terraform", "jenkins", "ci/cd", "microservices", "api",
  "sql", "mongodb", "postgresql", "oracle", "salesforce", "sap",
  "blockchain", "fintech", "saas", "paas", "iaas",
  // Industries & Companies
  "technology", "tech", "software company", "it services",
  "information technology", "consulting", "digital", "analytics",
  "startup", "computer", "semiconductor", "telecom",
  "microsoft", "google", "amazon", "meta", "apple", "oracle",
  "ibm", "cisco", "intel", "nvidia", "salesforce", "adobe",
  "infosys", "tcs", "wipro", "cognizant", "accenture", "deloitte",
  "capgemini", "hcl", "tech mahindra",
];

function isITRelated(profile) {
  // Combine all available text from the profile into one searchable string
  const text = [
    profile.title || "",
    profile.company || "",
    profile.snippet || "",
  ].join(" ").toLowerCase();

  // Check if any IT keyword matches
  return IT_KEYWORDS.some((keyword) => text.includes(keyword));
}

// ─── Main lookup endpoint ───
app.post("/api/lookup", async (req, res) => {
  try {
    const { email, name: userProvidedName, country: userProvidedCountry } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid email address.",
      });
    }

    const trimmedName = userProvidedName?.trim() || null;
    const trimmedCountry = userProvidedCountry?.trim() || null;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Lookup] Starting lookup for: ${email}${trimmedName ? ` (name: ${trimmedName})` : ""}${trimmedCountry ? ` (country: ${trimmedCountry})` : ""}`);
    console.log(`${"=".repeat(60)}`);

    // ── Step 1: Try Apollo first (pass name if provided for better match) ──
    const apolloData = await lookupApollo(email, trimmedName);

    const apolloName = apolloData?.name || null;
    const apolloCompany = apolloData?.company || null;
    const apolloTitle = apolloData?.title || null;
    const apolloLinkedIn = apolloData?.linkedin_url || null;

    if (apolloData) {
      console.log(`[Lookup] Apollo — Name: ${apolloName}, Company: ${apolloCompany}, LinkedIn: ${apolloLinkedIn}`);
    }

    // ── Step 2: Gather identity from free sources in parallel ──
    const [githubData, gravatarData] = await Promise.all([
      lookupGitHub(email),
      lookupGravatar(email),
    ]);

    // ── Step 3: Build best known identity ──
    // User-provided name takes highest priority
    const discoveredName =
      trimmedName ||
      apolloName ||
      githubData?.name ||
      gravatarData?.name ||
      extractNameFromEmail(email);

    const discoveredCompany = apolloCompany || githubData?.company || null;
    const discoveredLocation = trimmedCountry || githubData?.location || gravatarData?.location || null;
    const directLinkedIn =
      apolloLinkedIn || githubData?.linkedin_url || gravatarData?.linkedin_url || null;

    console.log(
      `[Lookup] Discovered — Name: "${discoveredName}", Company: "${discoveredCompany || "unknown"}", Location: "${discoveredLocation || "unknown"}"`
    );

    // ── Step 4: Find the matched person's LinkedIn profiles ──
    let matchedProfiles = [];

    if (directLinkedIn) {
      // We already have a direct LinkedIn URL — add it as the first result
      matchedProfiles.push({
        linkedin_url: directLinkedIn,
        name: discoveredName,
        title: apolloTitle || null,
        company: discoveredCompany || null,
        snippet: null,
      });
    }

    if (discoveredName && discoveredName.length >= 2) {
      // Search Google for LinkedIn profiles matching the name
      const googleProfiles = await findMatchedProfiles(
        email, discoveredName, discoveredCompany, discoveredLocation
      );

      // Merge with direct result (dedup by URL)
      const existingUrls = new Set(matchedProfiles.map((p) => p.linkedin_url));
      for (const gp of googleProfiles) {
        if (!existingUrls.has(gp.linkedin_url)) {
          matchedProfiles.push(gp);
          existingUrls.add(gp.linkedin_url);
        }
      }
    }

    // Enrich the top profile with Apollo data if available
    if (matchedProfiles.length > 0 && apolloData) {
      if (!matchedProfiles[0].title && apolloTitle) matchedProfiles[0].title = apolloTitle;
      if (!matchedProfiles[0].company && apolloCompany) matchedProfiles[0].company = apolloCompany;
      if (!matchedProfiles[0].name && apolloName) matchedProfiles[0].name = apolloName;
    }

    // If no matched profiles found at all
    if (matchedProfiles.length === 0) {
      if (apolloData && (apolloName || apolloCompany)) {
        matchedProfiles.push({
          linkedin_url: null,
          name: apolloName,
          title: apolloTitle,
          company: apolloCompany,
          snippet: null,
        });
      } else {
        return res.status(404).json({
          success: false,
          error: "No LinkedIn profile found for this email.",
        });
      }
    }

    // ── Step 5: Find current employees at the same company ──
    // Use the top profile's company for the company search
    const companyName = matchedProfiles[0].company || discoveredCompany;
    let companyEmployees = [];

    if (companyName) {
      // Exclude all matched profile URLs from company results
      const matchedUrls = new Set(matchedProfiles.map((p) => p.linkedin_url).filter(Boolean));
      const rawEmployees = await findCompanyEmployees(companyName, null);
      companyEmployees = rawEmployees.filter((e) => !matchedUrls.has(e.linkedin_url));
    }

    // ── Step 6: Apply IT industry filter (auto) ──
    const beforeMatch = matchedProfiles.length;
    const beforeEmp = companyEmployees.length;

    // Always keep the first matched profile (it's the target person),
    // filter the rest to only IT/tech-related profiles
    if (matchedProfiles.length > 1) {
      const first = matchedProfiles[0];
      const rest = matchedProfiles.slice(1).filter(isITRelated);
      matchedProfiles = [first, ...rest];
    }

    // Filter company employees to only IT/tech-related
    companyEmployees = companyEmployees.filter(isITRelated);

    console.log(`[Filter] IT filter — Matched: ${beforeMatch} → ${matchedProfiles.length}, Employees: ${beforeEmp} → ${companyEmployees.length}`);

    console.log(`[Lookup] Done — Matched profiles: ${matchedProfiles.length}, Company employees: ${companyEmployees.length}`);

    return res.json({
      success: true,
      searched_name: discoveredName,
      matched_profiles: matchedProfiles,
      company_name: companyName || null,
      company_employees: companyEmployees,
      sources_checked: {
        apollo: !!apolloData,
        github: !!githubData,
        gravatar: !!gravatarData,
      },
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      success: false,
      error: "An internal server error occurred. Please try again later.",
    });
  }
});

// Catch-all: serve frontend for any non-API route (SPA support)
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("Lookup pipeline: Apollo -> GitHub -> Gravatar -> Google Custom Search");
  if (process.env.APOLLO_API_KEY) {
    console.log("Apollo API key: configured");
  } else {
    console.log("Apollo API key: not set (skipping Apollo)");
  }
});
