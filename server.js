// 🏠 SLIZZ BACKEND
// This small server sits between SLIZZISTANT and Notion.
// It fetches your Notion data and sends it back as a clean snapshot.

const express = require('express');
const cors = require('cors');
const app = express();

// Allow SLIZZISTANT (any website) to call this server
app.use(cors());
app.use(express.json());

// ── CONFIG ───────────────────────────────────────────────────────────────────
// These come from environment variables (you set these in Railway - never paste keys into code!)
const NOTION_KEY = process.env.NOTION_KEY;
const PORT = process.env.PORT || 3000;

// ── YOUR NOTION PAGE/DATABASE IDs ──────────────────────────────────────────────
// These are from your Notion workspace. See SETUP.md for how to find them.
const NOTION_IDS = {
  staff:      process.env.NOTION_STAFF_ID,       // Staff page
  suppliers:  process.env.NOTION_SUPPLIERS_ID,   // Suppliers page
  campaigns:  process.env.NOTION_CAMPAIGNS_DB,   // Campaigns database
  inbox:      process.env.NOTION_INBOX_DB,       // Inbox/ideas database
  projects:   process.env.NOTION_PROJECTS_DB,    // Projects database
};

// ── NOTION API HELPER ───────────────────────────────────────────────────────────
async function notionGet(endpoint) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    }
  });
  return res.json();
}

async function notionQuery(databaseId, filter) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(filter || {})
  });
  return res.json();
}

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────────
// Visit your Railway URL to make sure it's running
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '🏠 Slizz Backend is alive!' });
});

// ── MAIN SNAPSHOT ENDPOINT ───────────────────────────────────────────────────────
// SLIZZISTANT calls this to get a fresh snapshot of your Notion data
app.get('/snapshot', async (req, res) => {
  try {
    // Fetch everything in parallel (fast!)
    const [campaigns, inbox, projects] = await Promise.all([
      notionQuery(NOTION_IDS.campaigns, {
        filter: {
          property: 'Status',
          status: { does_not_equal: 'Complete' }
        }
      }),
      notionQuery(NOTION_IDS.inbox, {
        filter: {
          property: 'Status',
          select: { equals: 'Raw' }
        }
      }),
      notionQuery(NOTION_IDS.projects, {
        filter: {
          property: 'Status',
          status: { does_not_equal: 'Done' }
        }
      })
    ]);

    // Format campaigns
    const activeCampaigns = (campaigns.results || []).map(p => ({
      name: p.properties['Campaign Name']?.title?.[0]?.plain_text || 'Untitled',
      status: p.properties['Status']?.status?.name || '?',
      priority: p.properties['Priority']?.select?.name || '?',
      platform: (p.properties['Platform']?.multi_select || []).map(x => x.name).join(', '),
      deadline: p.properties['Deadline']?.date?.start || null,
    }));

    // Format inbox ideas
    const inboxItems = (inbox.results || []).map(p => ({
      name: p.properties['Idea Name']?.title?.[0]?.plain_text || 'Untitled',
      priority: p.properties['Priority']?.select?.name || '?',
      type: p.properties['Type']?.select?.name || '?',
    }));

    // Format projects
    const activeProjects = (projects.results || []).map(p => ({
      name: p.properties['Project name']?.title?.[0]?.plain_text || 'Untitled',
      status: p.properties['Status']?.status?.name || '?',
      priority: p.properties['Priority']?.select?.name || '?',
      end: p.properties['End date']?.date?.start || null,
    }));

    // Build the tentacle snapshot
    const snapshot = {
      generatedAt: new Date().toISOString(),
      tentacles: {
        ops: {
          label: 'Ops',
          description: 'Suppliers, ordering, kitchen systems',
          alerts: [],  // You can add supplier alerts here later
          taskCount: 0,
        },
        creative: {
          label: 'Creative',
          description: 'Campaigns & content',
          activeCampaigns,
          taskCount: activeCampaigns.length,
          topPriority: activeCampaigns.find(c => c.priority === 'High')?.name || null,
        },
        people: {
          label: 'People',
          description: 'Staff roster, contacts, roles',
          alerts: [],  // You can add roster gaps here later
          taskCount: 0,
        },
        growth: {
          label: 'Growth',
          description: 'Catering, expansion, revenue goals',
          activeProjects,
          taskCount: activeProjects.length,
          topPriority: activeProjects.find(p => p.priority === 'High')?.name || null,
        },
        network: {
          label: 'Network',
          description: 'Collabs, outreach, brand partnerships',
          inboxItems: inboxItems.filter(i => i.type === 'Community' || i.type === 'Collaboration'),
          taskCount: 0,
        }
      },
      // This is the context block for your Claude "Ask" button
      claudeContext: buildClaudeContext(activeCampaigns, inboxItems, activeProjects),
    };

    res.json(snapshot);

  } catch (err) {
    console.error('Snapshot error:', err);
    res.status(500).json({ error: 'Failed to fetch snapshot', detail: err.message });
  }
});

// ── CLAUDE CONTEXT BUILDER ────────────────────────────────────────────────────────
// This builds the smart context that gets sent to Claude when you tap "Ask"
function buildClaudeContext(campaigns, inbox, projects) {
  const lines = [
    `I'm Scott, owner of Thin Slizzy — rock n roll pizzeria at 115 Johnston St Collingwood, next to The Tote.`,
    `Solo operator, ~$18k/week revenue, casual staff weekends.`,
    ``,
    `— LIVE NOTION DATA —`,
  ];

  if (campaigns.length) {
    lines.push(`Active Campaigns (${campaigns.length}):`);
    campaigns.forEach(c => {
      lines.push(`  • ${c.name} [${c.status}] [${c.priority} priority]${c.deadline ? ' — due ' + c.deadline : ''}`);
    });
  }

  if (projects.length) {
    lines.push(`Active Projects (${projects.length}):`);
    projects.forEach(p => {
      lines.push(`  • ${p.name} [${p.status}] [${p.priority} priority]`);
    });
  }

  if (inbox.length) {
    lines.push(`Raw Ideas in Inbox (${inbox.length}):`);
    inbox.forEach(i => {
      lines.push(`  • ${i.name} [${i.type}]`);
    });
  }

  lines.push(``);
  lines.push(`What should I focus on right now? What am I missing?`);

  return lines.join('\n');
}

// ── START ────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏠 Slizz Backend running on port ${PORT}`);
});
