import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { JSDOM } from 'jsdom';

export async function parseBRI(): Promise<string> {
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
        // Крок 1 — просто відкрити
        await page.goto('https://bri.co.id/web/guest/kurs-detail', {
            waitUntil: 'domcontentloaded',
            timeout: 8000, // жорсткий таймаут щоб не зависало
        });

        const url = page.url();
        const html = await page.content();

        return JSON.stringify({
            url,                          // чи не редіректить?
            htmlLength: html.length,      // чи є взагалі контент?
            preview: html.slice(0, 2000), // перші 2000 символів
        }, null, 2);

    } catch (err) {
        return JSON.stringify({ error: String(err) });
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