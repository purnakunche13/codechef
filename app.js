const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Home page
app.get('/', (req, res) => {
    res.render('index', { results: null, error: null, usernames: '' });
});

// Fetch CodeChef user data by scraping the profile page
async function fetchUserData(username) {
    // Scrape the CodeChef profile page
    try {
        const response = await axios.get(`https://www.codechef.com/users/${username}`, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);

        // ── Rating ──────────────────────────────────────────────
        const rating = $('.rating-number').first().text().trim() || 'N/A';

        // ── Stars ────────────────────────────────────────────────
        const starCount = $('.rating-star').find('span').length || 0;
        const stars = starCount ? '★'.repeat(starCount) : '';

        // ── Global & Country Rank ────────────────────────────────
        let globalRank = 'N/A';
        let countryRank = 'N/A';

        $('.rating-ranks ul li').each((i, el) => {
            const text = $(el).text().trim();
            const num = $(el).find('strong').text().trim().replace(/[^\d]/g, '');
            if (text.toLowerCase().includes('global')) globalRank = num || 'N/A';
            if (text.toLowerCase().includes('country')) countryRank = num || 'N/A';
        });

        // Fallback rank selectors
        if (globalRank === 'N/A') {
            const ranks = $('.rating-ranks strong');
            if (ranks.length >= 1) globalRank = $(ranks[0]).text().trim().replace(/[^\d]/g, '') || 'N/A';
            if (ranks.length >= 2) countryRank = $(ranks[1]).text().trim().replace(/[^\d]/g, '') || 'N/A';
        }

        // ── Contest History ──────────────────────────────────────
        // The rated contest table is inside .contest-participated-count or
        // a table inside the rating section
        let lastContest = 'N/A';
        let problemsSolved = 'N/A';
        let ratingChange = 'N/A';
        let ratingChangeSign = '';  // '+' | '-' | ''

        // Try reading the rating graph data embedded as JSON in the page
        const scriptTags = $('script').toArray();
        for (const tag of scriptTags) {
            const html = $(tag).html() || '';
            // CodeChef embeds contest history in a JS variable like:
            // var all_rating = [...];
            const match = html.match(/var\s+all_rating\s*=\s*(\[.*?\])\s*;/s);
            if (match) {
                try {
                    const allRating = JSON.parse(match[1]);
                    if (allRating.length > 0) {
                        const last = allRating[allRating.length - 1];
                        const prev = allRating.length > 1 ? allRating[allRating.length - 2] : null;

                        lastContest = last.code || last.name || 'N/A';
                        problemsSolved = last.problems_solved !== undefined ? last.problems_solved : (last.num_problems_solved !== undefined ? last.num_problems_solved : 'N/A');

                        const newRating = parseInt(last.rating, 10);
                        const oldRating = prev ? parseInt(prev.rating, 10) : (parseInt(last.rating, 10) - (last.diff || 0));
                        if (!isNaN(newRating) && !isNaN(oldRating)) {
                            const diff = newRating - oldRating;
                            ratingChangeSign = diff >= 0 ? '+' : '-';
                            ratingChange = `${ratingChangeSign}${Math.abs(diff)}`;
                        }
                    }
                } catch (e) { /* JSON parse failed */ }
                break;
            }
        }

        // Fallback: try scraping the table rows
        if (lastContest === 'N/A') {
            const rows = $('table.dataTable tbody tr, .rating-table tbody tr, table tbody tr').toArray();
            for (const row of rows) {
                const cells = $(row).find('td');
                if (cells.length >= 3) {
                    const first = $(cells[0]).text().trim();
                    if (first && first !== 'Rank') {
                        lastContest = $(cells[1]).text().trim() || first;
                        const changeText = $(cells[3] || cells[2]).text().trim();
                        const changeNum = parseInt(changeText.replace(/[^\d-]/g, ''), 10);
                        if (!isNaN(changeNum)) {
                            ratingChangeSign = changeNum >= 0 ? '+' : '-';
                            ratingChange = `${ratingChangeSign}${Math.abs(changeNum)}`;
                        }
                        break;
                    }
                }
            }
        }

        return {
            username,
            rating,
            stars,
            globalRank,
            countryRank,
            lastContest,
            ratingChange,
            ratingChangeSign,
            error: null
        };

    } catch (err) {
        return {
            username,
            rating: 'N/A',
            stars: '',
            globalRank: 'N/A',
            countryRank: 'N/A',
            lastContest: 'N/A',
            ratingChange: 'N/A',
            ratingChangeSign: '',
            error: `User "${username}" not found or request failed`
        };
    }
}

// Lookup route
app.post('/lookup', async (req, res) => {
    const input = req.body.usernames || '';

    // Parse usernames — one per line
    const usernames = input
        .split(/\r?\n/)
        .map(u => u.trim())
        .filter(u => u.length > 0);

    if (usernames.length === 0) {
        return res.render('index', {
            results: null,
            error: 'Please enter at least one username.',
            usernames: input
        });
    }

    // Fetch data for all usernames in parallel
    const results = await Promise.all(usernames.map(fetchUserData));

    res.render('index', {
        results,
        error: null,
        usernames: input
    });
});

app.listen(PORT, () => {
    console.log(`🚀 CodeChef Rating Lookup running at http://localhost:${PORT}`);
});
