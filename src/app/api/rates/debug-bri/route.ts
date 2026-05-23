import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export async function GET() {
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

    try {
        await page.goto('https://bri.co.id/web/guest/kurs-detail', {
            waitUntil: 'domcontentloaded',
            timeout: 8000,
        });

        // Чекаємо 5 секунд щоб React відрендерив дані
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5000)));

        const url = page.url();
        const html = await page.content();

        const hasContainer = html.includes('order-2');
        const hasRates = html.includes('border-b border-black');

        return Response.json({
            url,
            htmlLength: html.length,
            hasContainer,
            hasRates,
            preview: html.slice(0, 2000),
        });

    } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
    } finally {
        await browser.close();
    }
}