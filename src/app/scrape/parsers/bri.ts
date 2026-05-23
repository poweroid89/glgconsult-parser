import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { JSDOM } from 'jsdom';

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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
    });

    try {
        await page.goto('https://bri.co.id/web/guest/kurs-detail', {
            waitUntil: 'domcontentloaded',
        });

        const exchangeRates: Record<string, { buy: number; sell: number }> = {};

        const containerSelector = 'div.w-1\\/2.mdmax\\:w-full.px-10.order-2';
        const rowSelector = `${containerSelector} div.flex.items-center.border-b.border-black`;

        let hasNextPage = true;

        while (hasNextPage) {
            const html: string = await page.content();
            const dom = new JSDOM(html);
            const doc = dom.window.document;

            doc.querySelectorAll(rowSelector).forEach((row: Element) => {
                const divs = row.children;
                if (divs.length >= 3) {
                    const currencyRaw = divs[0].textContent?.trim() || '';
                    const currencyMatch = currencyRaw.match(/[A-Z]{3}$/);
                    const currency = currencyMatch ? currencyMatch[0] : null;

                    const buyText = divs[1].textContent?.trim() ?? '0';
                    const sellText = divs[2].textContent?.trim() ?? '0';

                    if (currency && currency !== 'KURS' && currency !== 'BUY') {
                        exchangeRates[currency] = {
                            buy: parseNumberSafe(buyText.replace(/,/g, '')),
                            sell: parseNumberSafe(sellText.replace(/,/g, '')),
                        };
                    }
                }
            });

            hasNextPage = await page.evaluate((selector: string): boolean => {
                const container = document.querySelector(selector);
                if (!container) return false;

                const buttons = Array.from(container.querySelectorAll('button'));
                const nextButton = buttons.find(btn => btn.textContent?.trim() === 'Next');

                if (nextButton && !nextButton.hasAttribute('disabled') && !nextButton.classList.contains('cursor-not-allowed')) {
                    (nextButton as HTMLButtonElement).click();
                    return true;
                }
                return false;
            }, containerSelector);

            if (hasNextPage) {
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
            }
        }

        return { bank: "bri.co.id", rates: exchangeRates };
    } finally {
        await browser.close();
    }
}

function parseNumberSafe(value: unknown): number {
    if (typeof value !== 'string') return 0;
    const cleaned = value.replace(/[^\d.-]/g, '').trim();
    if (cleaned === '' || isNaN(Number(cleaned))) return 0;
    return parseFloat(cleaned);
}