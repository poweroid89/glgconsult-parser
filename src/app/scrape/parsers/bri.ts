import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { JSDOM } from 'jsdom';

export async function parseBRI(): Promise<{ bank: string; rates: Record<string, { buy: number; sell: number }> }> {
    const browser = await puppeteer.launch({
        args: [
            ...(chromium.args || []),
            '--disable-blink-features=AutomationControlled', // Відключаємо автоматизацію
            '--disable-dev-shm-usage', // Уникаємо проблеми із пам’яттю в Docker
            '--no-sandbox', // Для сумісності з серверним середовищем
            '--disable-setuid-sandbox',
            '--disable-web-security', // Вимикаємо CORS для тестування
            '--disable-features=site-per-process', // Уникаємо ізоляції сайтів
            '--enable-features=NetworkService,NetworkServiceInProcess', // Увімкнення мережевих функцій
            '--window-size=1920,1080', // Реалістичний розмір вікна
        ],
        executablePath: await chromium.executablePath(),
        headless: true,
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
        'Referer': 'https://www.google.com/',
        'Accept-Language': 'en-US,en;q=0.9,uk;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
    });
    await page.setExtraHTTPHeaders({
        "referer": "https://google.com",
        "accept-language": "en-US,en;q=0.9,uk;q=0.8",
        "connection": "keep-alive",
        "cache-control": "no-cache",
    });
    await page.goto('https://bri.co.id/web/guest/kurs-detail', { waitUntil: 'networkidle2' });

    const exchangeRates: Record<string, { buy: number; sell: number }> = {};
    let hasNextPage = true;

    // Селектор головного контейнера (екрануємо двокрапку для Tailwind класу)
    const containerSelector = 'div.w-1\\/2.mdmax\\:w-full.px-10.order-2';
    // Рядки всередині цього контейнера
    const rowSelector = `${containerSelector} div.flex.items-center.border-b.border-black`;

    // Чекаємо завантаження контенту по новому точному селектору
    await page.waitForSelector(containerSelector, { timeout: 15000 }).catch(() => { });

    while (hasNextPage) {
        const html: string = await page.content();
        const dom = new JSDOM(html);
        const document = dom.window.document;

        // Шукаємо рядки виключно всередині потрібного контейнера
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

        // Клікатко пагінації теж обмежуємо цим контейнером, щоб не зачепити інші кнопки на сайті
        hasNextPage = await page.evaluate((containerSel) => {
            const container = document.querySelector(containerSel);
            if (!container) return false;

            const buttons = Array.from(container.querySelectorAll('button'));
            const nextButton = buttons.find(btn => btn.textContent?.trim() === 'Next');

            if (nextButton && !nextButton.disabled && !nextButton.classList.contains('cursor-not-allowed')) {
                nextButton.click();
                return true;
            }
            return false;
        }, containerSelector);

        if (hasNextPage) {
            await new Promise<void>(resolve => setTimeout(resolve, 1500));
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