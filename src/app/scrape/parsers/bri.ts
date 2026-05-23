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
            '--window-size=1920,1080',
        ],
        executablePath: await chromium.executablePath(),
        headless: chromium.headless as boolean, // Явно кажемо, що це boolean
        defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
        if (req.url().includes("jquery.dataTables.min.js")) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setExtraHTTPHeaders({
        'referer': 'https://www.google.com/',
        'accept-language': 'en-US,en;q=0.9,uk;q=0.8',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'connection': 'keep-alive',
        'cache-control': 'no-cache',
        'upgrade-insecure-requests': '1',
    });

    await page.goto('https://bri.co.id/web/guest/kurs-detail', { waitUntil: 'networkidle2' });

    const exchangeRates: Record<string, { buy: number; sell: number }> = {};
    let hasNextPage = true;

    const containerSelector = 'div.w-1\\/2.mdmax\\:w-full.px-10.order-2';
    const rowSelector = `${containerSelector} div.flex.items-center.border-b.border-black`;

    await page.waitForSelector(containerSelector, { timeout: 15000 }).catch(() => {
        console.error("Контейнер з курсами не знайдено за таймаутом");
    });

    while (hasNextPage) {
        const html: string = await page.content();
        const dom = new JSDOM(html);
        const document = dom.window.document;

        const rows = document.querySelectorAll(rowSelector);

        rows.forEach((row: Element) => {
            const divs = row.children;
            if (divs.length >= 3) {
                const currencyRaw = divs[0].textContent?.trim() || '';
                const currencyMatch = currencyRaw.match(/[A-Z]{3}$/);
                const currency = currencyMatch ? currencyMatch[0] : null;

                const buyText = divs[1].textContent?.trim() ?? '0';
                const sellText = divs[2].textContent?.trim() ?? '0';

                if (currency && currency !== 'KURS' && currency !== 'BUY') {
                    const buy = parseNumberSafe(buyText.replace(/\./g, '').replace(',', '.'));
                    const sell = parseNumberSafe(sellText.replace(/\./g, '').replace(',', '.'));

                    exchangeRates[currency] = { buy, sell };
                }
            }
        });

        // Додаємо сувору типізацію для аргументу (selector: string) 
        // та повертаємо тип string | null
        const nextButtonSelector: string | null = await page.evaluate((selector: string): string | null => {
            const container = document.querySelector(selector);
            if (!container) return null;

            const buttons = Array.from(container.querySelectorAll('button'));
            const nextButton = buttons.find(btn => btn.textContent?.trim() === 'Next');

            if (nextButton && !nextButton.hasAttribute('disabled') && !nextButton.classList.contains('cursor-not-allowed')) {
                nextButton.setAttribute('data-puppeteer-next', 'true');
                return '[data-puppeteer-next="true"]';
            }
            return null;
        }, containerSelector);

        if (nextButtonSelector) {
            await page.click(nextButtonSelector);

            await page.evaluate((): void => {
                document.querySelector('[data-puppeteer-next="true"]')?.removeAttribute('data-puppeteer-next');
            });

            await new Promise<void>(resolve => setTimeout(resolve, 2000));
        } else {
            hasNextPage = false;
        }
    }

    await browser.close();
    return { bank: "bri.co.id", rates: exchangeRates };
}

function parseNumberSafe(value: unknown): number {
    if (typeof value !== 'string') return 0;
    const cleaned = value.replace(/[^\d.-]/g, '').trim();
    if (cleaned === '' || isNaN(Number(cleaned))) return 0;

    return parseFloat(cleaned);
}