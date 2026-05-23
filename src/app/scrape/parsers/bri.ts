import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export async function parseBRI(): Promise<{ bank: string; rates: Record<string, { buy: number; sell: number }> }> {
    const browser = await puppeteer.launch({
        args: [
            ...(chromium.args || []),
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=site-per-process',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--window-size=1920,1080',
        ],
        executablePath: await chromium.executablePath(),
        headless: true,
        defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setExtraHTTPHeaders({
        'Referer': 'https://www.google.com/',
        'Accept-Language': 'en-US,en;q=0.9,uk;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
    });

    try {
        await page.goto('https://bri.co.id/web/guest/kurs-detail', {
            waitUntil: 'domcontentloaded',
        });

        const html = await page.content();

        const key = '"listTable":';
        const start = html.indexOf(key);
        if (start === -1) throw new Error('listTable not found');

        const arrayStart = html.indexOf('[', start);
        let depth = 0;
        let arrayEnd = arrayStart;

        for (let i = arrayStart; i < html.length; i++) {
            if (html[i] === '[') depth++;
            else if (html[i] === ']') {
                depth--;
                if (depth === 0) { arrayEnd = i; break; }
            }
        }

        const listTable = JSON.parse(html.slice(arrayStart, arrayEnd + 1)) as Array<{
            currency: string;
            buyRateERate: string;
            sellRateERate: string;
        }>;

        const exchangeRates: Record<string, { buy: number; sell: number }> = {};

        listTable.forEach(item => {
            exchangeRates[item.currency] = {
                buy: parseFloat(item.buyRateERate),
                sell: parseFloat(item.sellRateERate),
            };
        });

        return { bank: "bri.co.id", rates: exchangeRates };
    } finally {
        await browser.close();
    }
}