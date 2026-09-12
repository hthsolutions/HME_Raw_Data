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

        try {
            // ---------------------------------------------------------
            // 1. Navigate to HME Cloud RCD
            // ---------------------------------------------------------
            await page.goto(request.url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });

            log.info(`Initial URL: ${page.url()}`);

            // ---------------------------------------------------------
            // 2. Wait for username field
            // ---------------------------------------------------------
            const usernameInput = page.locator(
                'input[name="username"]'
            );

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

            // Save screenshot after username is entered
            const usernameScreenshot = await page.screenshot({
                fullPage: true,
            });

            await Actor.setValue(
                'HME_USERNAME_ENTERED',
                usernameScreenshot,
                {
                    contentType: 'image/png',
                }
            );

            log.info(
                'Saved screenshot: HME_USERNAME_ENTERED'
            );

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
            const passwordInput = page.locator(
                'input[name="password"]'
            );

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

            // Save screenshot after password is entered
            const passwordScreenshot = await page.screenshot({
                fullPage: true,
            });

            await Actor.setValue(
                'HME_PASSWORD_ENTERED',
                passwordScreenshot,
                {
                    contentType: 'image/png',
                }
            );

            log.info(
                'Saved screenshot: HME_PASSWORD_ENTERED'
            );

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
            // 8. Wait for login/navigation
            // ---------------------------------------------------------
            try {
                await page.waitForURL(
                    currentUrl => {
                        return !currentUrl
                            .toString()
                            .toLowerCase()
                            .includes('login');
                    },
                    {
                        timeout: 30000,
                    }
                );

                log.info(
                    'Navigation away from login page detected.'
                );
            } catch {
                log.warning(
                    'URL did not clearly change away from login. ' +
                    'Continuing with page validation.'
                );
            }

            // Give the authenticated app time to render
            await page.waitForTimeout(5000);

            const finalUrl = page.url();

            log.info(`Final URL after login: ${finalUrl}`);

            // ---------------------------------------------------------
            // 9. Save screenshot after login
            // ---------------------------------------------------------
            const afterLoginScreenshot = await page.screenshot({
                fullPage: true,
            });

            await Actor.setValue(
                'HME_AFTER_LOGIN',
                afterLoginScreenshot,
                {
                    contentType: 'image/png',
                }
            );

            log.info(
                'Saved screenshot: HME_AFTER_LOGIN'
            );

            // ---------------------------------------------------------
            // 10. Basic login validation
            // ---------------------------------------------------------
            const passwordStillVisible = await page
                .locator('input[name="password"]')
                .isVisible()
                .catch(() => false);

            const usernameStillVisible = await page
                .locator('input[name="username"]')
                .isVisible()
                .catch(() => false);

            if (
                passwordStillVisible ||
                usernameStillVisible
            ) {
                log.warning(
                    'Login fields are still visible after login attempt.'
                );
            } else {
                log.info(
                    'Login fields are no longer visible.'
                );
            }

            // ---------------------------------------------------------
            // 11. Save page information for debugging
            // ---------------------------------------------------------
            const pageTitle = await page.title();

            log.info(`Page title: ${pageTitle}`);

            await Actor.setValue(
                'HME_LOGIN_RESULT',
                {
                    success:
                        !passwordStillVisible &&
                        !usernameStillVisible,
                    finalUrl,
                    pageTitle,
                    timestamp:
                        new Date().toISOString(),
                }
            );

            // ---------------------------------------------------------
            // 12. Push result to dataset
            // ---------------------------------------------------------
            await Actor.pushData({
                success:
                    !passwordStillVisible &&
                    !usernameStillVisible,
                finalUrl,
                pageTitle,
                timestamp:
                    new Date().toISOString(),
            });

            log.info('HME login flow completed.');

        } catch (error) {
            // ---------------------------------------------------------
            // Capture screenshot if anything fails
            // ---------------------------------------------------------
            log.error(
                `HME login failed: ${error.message}`
            );

            try {
                const failureScreenshot =
                    await page.screenshot({
                        fullPage: true,
                    });

                await Actor.setValue(
                    'HME_LOGIN_FAILURE',
                    failureScreenshot,
                    {
                        contentType: 'image/png',
                    }
                );

                log.info(
                    'Saved screenshot: HME_LOGIN_FAILURE'
                );
            } catch (screenshotError) {
                log.error(
                    `Unable to save failure screenshot: ${screenshotError.message}`
                );
            }

            // Save additional failure information
            await Actor.setValue(
                'HME_LOGIN_FAILURE_DETAILS',
                {
                    error: error.message,
                    url: page.url(),
                    timestamp:
                        new Date().toISOString(),
                }
            );

            throw error;
        }
    },

    async failedRequestHandler({
        page,
        request,
        log,
    }) {
        log.error(
            `Request failed permanently: ${request.url}`
        );

        try {
            const failedRequestScreenshot =
                await page.screenshot({
                    fullPage: true,
                });

            await Actor.setValue(
                'HME_REQUEST_FAILURE',
                failedRequestScreenshot,
                {
                    contentType: 'image/png',
                }
            );

            log.info(
                'Saved screenshot: HME_REQUEST_FAILURE'
            );
        } catch (error) {
            log.error(
                `Could not save request failure screenshot: ${error.message}`
            );
        }
    },
});

await crawler.run([
    {
        url,
        uniqueKey: 'HME_RCD_LOGIN',
    },
]);

await Actor.exit();