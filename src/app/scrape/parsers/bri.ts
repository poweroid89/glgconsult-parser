import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { JSDOM } from 'jsdom';

export async function parseBRI(): Promise<{ bank: string; rates: Record<string, { buy: number; sell: number }> }> {
    const browser = await puppeteer.launch({
        args: [
            ...(chromium.args || []),
            '--disable-blink-features=AutomationControlled', // Відключаємо автоматизацію
            '--disable-dev-shm-usage', // Уникаємо проблем із пам’яттю в Docker
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

    // Логи браузера для дебагу
    page.on('console', msg => console.log('[BROWSER]', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('[PAGE ERROR]', err));

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

    try {
        console.log('Відкриваємо сторінку...');
        await page.goto('https://bri.co.id/web/guest/kurs-detail', {
            waitUntil: 'domcontentloaded', // не networkidle2 — щоб не зависало
            timeout: 30000,
        });

        console.log('URL після переходу:', page.url());

        const exchangeRates: Record<string, { buy: number; sell: number }> = {};
        let hasNextPage = true;

        const containerSelector = 'div.w-1\\/2.mdmax\\:w-full.px-10.order-2';
        const rowSelector = `${containerSelector} div.flex.items-center.border-b.border-black`;

        console.log('Чекаємо контейнер...');
        await page.waitForSelector(containerSelector, { timeout: 15000 })
            .then(() => console.log('✅ Контейнер знайдено'))
            .catch(async () => {
                console.error('❌ Контейнер НЕ знайдено, перші 3000 символів HTML:');
                const html = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
                console.log(html);
            });

        let pageNum = 1;
        while (hasNextPage) {
            console.log(`Парсимо сторінку ${pageNum}...`);
            const html: string = await page.content();
            const dom = new JSDOM(html);
            const doc = dom.window.document;

            const rows = doc.querySelectorAll(rowSelector);
            console.log(`Знайдено рядків: ${rows.length}`);

            rows.forEach((row: Element) => {
                const divs = row.children;
                if (divs.length >= 3) {
                    const currencyRaw = divs[0].textContent?.trim() || '';
                    const currencyMatch = currencyRaw.match(/[A-Z]{3}$/);
                    const currency = currencyMatch ? currencyMatch[0] : null;

                    const buyText = divs[1].textContent?.trim() ?? '0';
                    const sellText = divs[2].textContent?.trim() ?? '0';

                    if (currency && currency !== 'KURS' && currency !== 'BUY') {
                        const buy = parseNumberSafe(buyText.replace(/,/g, ''));
                        const sell = parseNumberSafe(sellText.replace(/,/g, ''));
                        exchangeRates[currency] = { buy, sell };
                        console.log(`  ${currency}: buy=${buy}, sell=${sell}`);
                    }
                }
            });

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
                console.log('Клікаємо Next...');
                await page.click(nextButtonSelector);
                await page.evaluate((): void => {
                    document.querySelector('[data-puppeteer-next="true"]')?.removeAttribute('data-puppeteer-next');
                });
                await new Promise<void>(resolve => setTimeout(resolve, 2000));
                pageNum++;
            } else {
                console.log('Кнопки Next немає — завершуємо');
                hasNextPage = false;
            }
        }

        console.log('\n✅ Результат:', JSON.stringify(exchangeRates, null, 2));
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