import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();

const {
    url = 'https://hmecloud.com/new-reports/rcd',
    username,
    password,
} = input;

if (!username || !password) {
    throw new Error('Both username and password are required.');
}

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,

    launchContext: {
        launchOptions: {
            headless: true,
        },
    },

    async requestHandler({ page, request, log }) {
        log.info(`Opening HME Cloud RCD page: ${request.url}`);

        // ---------------------------------------------------------
        // 1. Navigate to HME Cloud RCD
        // ---------------------------------------------------------
        await page.goto(request.url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        log.info(`Current URL: ${page.url()}`);

        // ---------------------------------------------------------
        // 2. Wait for username field
        // ---------------------------------------------------------
        const usernameInput = page.locator('input[name="username"]');

        await usernameInput.waitFor({
            state: 'visible',
            timeout: 30000,
        });

        log.info('Username field found.');

        // ---------------------------------------------------------
        // 3. Enter username
        // ---------------------------------------------------------
        await usernameInput.fill(username);

        log.info('Username entered.');

        // Optional debug screenshot
        await page.screenshot({
            path: 'storage/key_value_stores/default/HME_USERNAME_ENTERED.png',
            fullPage: true,
        });

        // ---------------------------------------------------------
        // 4. Click Continue
        // ---------------------------------------------------------
        const continueButton = page.locator(
            'button[name="intent"][value="verify"]'
        );

        await continueButton.waitFor({
            state: 'visible',
            timeout: 15000,
        });

        log.info('Clicking Continue...');

        await continueButton.click();

        // ---------------------------------------------------------
        // 5. Wait for password field
        // ---------------------------------------------------------
        const passwordInput = page.locator('input[name="password"]');

        await passwordInput.waitFor({
            state: 'visible',
            timeout: 30000,
        });

        log.info('Password field found.');

        // ---------------------------------------------------------
        // 6. Enter password
        // ---------------------------------------------------------
        await passwordInput.fill(password);

        log.info('Password entered.');

        // Optional debug screenshot
        await page.screenshot({
            path: 'storage/key_value_stores/default/HME_PASSWORD_ENTERED.png',
            fullPage: true,
        });

        // ---------------------------------------------------------
        // 7. Click Login
        // ---------------------------------------------------------
        const loginButton = page.locator(
            'button[name="intent"][value="login"]'
        );

        await loginButton.waitFor({
            state: 'visible',
            timeout: 15000,
        });

        log.info('Clicking Login...');

        await loginButton.click();

        // ---------------------------------------------------------
        // 8. Wait for authentication/navigation
        // ---------------------------------------------------------
        try {
            await page.waitForURL(
                url => !url.toString().toLowerCase().includes('login'),
                {
                    timeout: 30000,
                }
            );
        } catch {
            log.warning(
                'URL did not clearly change away from login. ' +
                'Checking the resulting page anyway.'
            );
        }

        // Give the authenticated application a moment to render.
        await page.waitForTimeout(3000);

        const finalUrl = page.url();

        log.info(`Final URL after login: ${finalUrl}`);

        // ---------------------------------------------------------
        // 9. Capture authenticated page
        // ---------------------------------------------------------
        await page.screenshot({
            path: 'storage/key_value_stores/default/HME_AFTER_LOGIN.png',
            fullPage: true,
        });

        // ---------------------------------------------------------
        // 10. Basic login validation
        // ---------------------------------------------------------
        const passwordStillVisible = await page
            .locator('input[name="password"]')
            .isVisible()
            .catch(() => false);

        if (passwordStillVisible) {
            throw new Error(
                'Login may have failed because the password field ' +
                'is still visible after clicking Login.'
            );
        }

        log.info('HME Cloud login appears successful.');

        // ---------------------------------------------------------
        // 11. Save simple result for testing
        // ---------------------------------------------------------
        await Actor.pushData({
            success: true,
            finalUrl,
            timestamp: new Date().toISOString(),
        });
    },

    failedRequestHandler: async ({ page, request, log }) => {
        log.error(`Request failed: ${request.url}`);

        try {
            await page.screenshot({
                path: 'storage/key_value_stores/default/HME_LOGIN_FAILURE.png',
                fullPage: true,
            });
        } catch (error) {
            log.error(`Could not capture failure screenshot: ${error.message}`);
        }
    },
});

await crawler.run([
    {
        url,
        uniqueKey: 'HME_RCD',
    },
]);

await Actor.exit();