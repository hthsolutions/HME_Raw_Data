import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();

const {
    url = 'https://hmecloud.com/new-reports/rcd',

    username,
    password,

    store = '(Ungrouped) 11312 Leander - Other',

    report_date,

    start_hour = '10',
    start_minute = '30',
    start_ampm = 'AM',

    stop_hour = '11',
    stop_minute = '30',
    stop_ampm = 'PM',

    time_format = 'Seconds',
    include_pullins = 'No',
} = input;

if (!username || !password) {
    throw new Error('Both username and password are required.');
}

if (!report_date) {
    throw new Error(
        'report_date is required. Example: 09/10/2026'
    );
}


// =====================================================================
// HELPER: Save screenshot to Apify Key-Value Store
// =====================================================================
async function saveScreenshot(page, key) {
    const screenshot = await page.screenshot({
        fullPage: true,
    });

    await Actor.setValue(
        key,
        screenshot,
        {
            contentType: 'image/png',
        }
    );
}


// =====================================================================
// HELPER: Select a Fluent UI combobox value
// =====================================================================
async function selectCombobox(
    frame,
    selector,
    value,
    log
) {
    const inputField = frame.locator(selector);

    await inputField.waitFor({
        state: 'visible',
        timeout: 30000,
    });

    await inputField.click();

    await inputField.fill('');

    await inputField.fill(String(value));

    log.info(
        `Entered "${value}" into ${selector}`
    );

    // Give dropdown options time to render
    await frame.page().waitForTimeout(750);

    // Look for exact option in the same frame
    const exactOption = frame
        .getByRole('option', {
            name: String(value),
            exact: true,
        })
        .last();

    const optionVisible = await exactOption
        .isVisible()
        .catch(() => false);

    if (optionVisible) {
        await exactOption.click();

        log.info(
            `Selected dropdown option "${value}".`
        );
    } else {
        log.warning(
            `Exact dropdown option "${value}" was not found. ` +
            'Using Enter as fallback.'
        );

        await inputField.press('Enter');
    }

    await frame.page().waitForTimeout(500);
}


// =====================================================================
// HELPER: Wait until field becomes enabled
// =====================================================================
async function waitUntilEnabled(
    frame,
    selector,
    timeout = 60000
) {
    await frame.waitForFunction(
        (sel) => {
            const element =
                document.querySelector(sel);

            if (!element) {
                return false;
            }

            return (
                !element.disabled &&
                element.getAttribute(
                    'aria-disabled'
                ) !== 'true'
            );
        },
        selector,
        {
            timeout,
        }
    );
}


// =====================================================================
// HELPER: Find the frame containing the RCD Store combobox
// =====================================================================
async function findReportFrame(
    page,
    log,
    timeout = 60000
) {
    const startTime = Date.now();

    while (
        Date.now() - startTime < timeout
    ) {

        const frames = page.frames();

        log.info(
            `Searching ${frames.length} frame(s) for RCD Store combobox...`
        );

        for (
            let i = 0;
            i < frames.length;
            i++
        ) {
            const frame = frames[i];

            log.info(
                `Checking frame ${i}: ${frame.url()}`
            );

            try {
                const storeByRole =
                    frame.getByRole(
                        'combobox',
                        {
                            name: 'Store:',
                        }
                    );

                const roleCount =
                    await storeByRole.count();

                if (roleCount > 0) {
                    log.info(
                        `RCD Store combobox found in frame ${i}: ${frame.url()}`
                    );

                    return frame;
                }

                // Secondary fallback using the ID
                const storeById =
                    frame.locator(
                        '#P_STORE_ID-input'
                    );

                const idCount =
                    await storeById.count();

                if (idCount > 0) {
                    log.info(
                        `RCD Store input found by ID in frame ${i}: ${frame.url()}`
                    );

                    return frame;
                }

            } catch (error) {
                log.debug(
                    `Unable to inspect frame ${i}: ${error.message}`
                );
            }
        }

        await page.waitForTimeout(1000);
    }

    throw new Error(
        'Could not locate the RCD Store combobox in any page frame.'
    );
}


// =====================================================================
// CRAWLER
// =====================================================================
const crawler = new PlaywrightCrawler({

    maxRequestsPerCrawl: 1,

    // While developing, avoid repeated login attempts
    maxRequestRetries: 0,

    // Give HME enough time to authenticate/render report UI
    requestHandlerTimeoutSecs: 180,

    launchContext: {
        launchOptions: {
            headless: true,
        },
    },

    async requestHandler({
        page,
        request,
        log,
    }) {

        log.info(
            `Opening HME Cloud RCD page: ${request.url}`
        );

        try {

            // =========================================================
            // 1. OPEN HME RCD PAGE
            // =========================================================
            await page.goto(
                request.url,
                {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000,
                }
            );

            log.info(
                `Initial URL: ${page.url()}`
            );


            // =========================================================
            // 2. USERNAME
            // =========================================================
            const usernameInput =
                page.locator(
                    'input[name="username"]'
                );

            await usernameInput.waitFor({
                state: 'visible',
                timeout: 30000,
            });

            log.info(
                'Username field found.'
            );

            await usernameInput.fill(
                username
            );

            log.info(
                'Username entered.'
            );


            // =========================================================
            // 3. CONTINUE
            // =========================================================
            const continueButton =
                page.locator(
                    'button[name="intent"][value="verify"]'
                );

            await continueButton.waitFor({
                state: 'visible',
                timeout: 15000,
            });

            log.info(
                'Clicking Continue...'
            );

            await continueButton.click();


            // =========================================================
            // 4. PASSWORD
            // =========================================================
            const passwordInput =
                page.locator(
                    'input[name="password"]'
                );

            await passwordInput.waitFor({
                state: 'visible',
                timeout: 30000,
            });

            log.info(
                'Password field found.'
            );

            await passwordInput.fill(
                password
            );

            log.info(
                'Password entered.'
            );


            // =========================================================
            // 5. LOGIN
            // =========================================================
            const loginButton =
                page.locator(
                    'button[name="intent"][value="login"]'
                );

            await loginButton.waitFor({
                state: 'visible',
                timeout: 15000,
            });

            log.info(
                'Clicking Login...'
            );

            await loginButton.click();

            await page.waitForTimeout(3000);

            log.info(
                `URL after login click: ${page.url()}`
            );


            // =========================================================
            // 6. SCREENSHOT AFTER LOGIN
            // =========================================================
            await saveScreenshot(
                page,
                'HME_AFTER_LOGIN_CLICK'
            );

            log.info(
                'Saved screenshot: HME_AFTER_LOGIN_CLICK'
            );


            // =========================================================
            // 7. FIND THE REPORT FRAME
            // =========================================================
            log.info(
                'Looking for the frame containing the RCD report...'
            );

            const reportFrame =
                await findReportFrame(
                    page,
                    log,
                    60000
                );

            log.info(
                `Using RCD report frame: ${reportFrame.url()}`
            );


            // =========================================================
            // 8. FIND STORE INPUT
            // =========================================================
            let storeInput =
                reportFrame.getByRole(
                    'combobox',
                    {
                        name: 'Store:',
                    }
                );

            if (
                await storeInput.count() === 0
            ) {
                storeInput =
                    reportFrame.locator(
                        '#P_STORE_ID-input'
                    );
            }

            await storeInput.waitFor({
                state: 'visible',
                timeout: 30000,
            });

            log.info(
                'RCD Store selector is visible.'
            );


            // =========================================================
            // 9. SELECT STORE
            // =========================================================
            log.info(
                `Selecting store: ${store}`
            );

            await storeInput.click();

            await storeInput.fill('');

            await storeInput.fill(store);

            await page.waitForTimeout(750);

            const storeOption =
                reportFrame
                    .getByRole(
                        'option',
                        {
                            name: store,
                            exact: true,
                        }
                    )
                    .last();

            if (
                await storeOption
                    .isVisible()
                    .catch(() => false)
            ) {

                await storeOption.click();

                log.info(
                    `Store selected: ${store}`
                );

            } else {

                log.warning(
                    'Exact Store option not found. Using Enter.'
                );

                await storeInput.press(
                    'Enter'
                );
            }


            // =========================================================
            // 10. ENTER REPORT DATE
            // =========================================================
            const dateInput =
                reportFrame.locator(
                    'input[aria-label="Date (MM/DD/YYYY):"]'
                );

            await dateInput.waitFor({
                state: 'visible',
                timeout: 30000,
            });

            log.info(
                `Entering report date: ${report_date}`
            );

            await dateInput.click();

            await dateInput.fill(
                report_date
            );

            await dateInput.press(
                'Enter'
            );

            log.info(
                'Date entered. Waiting for time controls to become enabled...'
            );


            // =========================================================
            // 11. WAIT FOR START HOUR TO BECOME ENABLED
            // =========================================================
            await waitUntilEnabled(
                reportFrame,
                '#P_HOUR_INI-input',
                60000
            );

            log.info(
                'Start time fields are now enabled.'
            );

            await page.waitForTimeout(
                1000
            );


            // =========================================================
            // 12. START HOUR
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_HOUR_INI-input',
                start_hour,
                log
            );


            // =========================================================
            // 13. START MINUTE
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_MINUTE_INI-input',
                start_minute,
                log
            );


            // =========================================================
            // 14. START AM/PM
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_AMPM_INI-input',
                start_ampm,
                log
            );


            // =========================================================
            // 15. STOP HOUR
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_HOUR_END-input',
                stop_hour,
                log
            );


            // =========================================================
            // 16. STOP MINUTE
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_MINUTE_END-input',
                stop_minute,
                log
            );


            // =========================================================
            // 17. STOP AM/PM
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_AMPM_END-input',
                stop_ampm,
                log
            );


            // =========================================================
            // 18. TIME FORMAT
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_FORMAT_TIME-input',
                time_format,
                log
            );


            // =========================================================
            // 19. INCLUDE PULLINS
            // =========================================================
            await selectCombobox(
                reportFrame,
                '#P_PULLINS-input',
                include_pullins,
                log
            );


            // =========================================================
            // 20. SCREENSHOT BEFORE VIEW REPORT
            // =========================================================
            await saveScreenshot(
                page,
                'HME_RCD_PARAMETERS_COMPLETE'
            );

            log.info(
                'Saved screenshot: HME_RCD_PARAMETERS_COMPLETE'
            );


            // =========================================================
            // 21. CLICK VIEW REPORT
            // =========================================================
            const viewReportButton =
                reportFrame.getByText(
                    'View report',
                    {
                        exact: true,
                    }
                );

            await viewReportButton.waitFor({
                state: 'visible',
                timeout: 30000,
            });

            log.info(
                'Clicking View report...'
            );

            await viewReportButton.click();


            // =========================================================
            // 22. WAIT FOR REPORT RESPONSE
            // =========================================================
            await page.waitForTimeout(
                5000
            );

            log.info(
                'View report clicked.'
            );

            log.info(
                `Current URL: ${page.url()}`
            );


            // =========================================================
            // 23. SCREENSHOT AFTER VIEW REPORT
            // =========================================================
            await saveScreenshot(
                page,
                'HME_AFTER_VIEW_REPORT'
            );

            log.info(
                'Saved screenshot: HME_AFTER_VIEW_REPORT'
            );


            // =========================================================
            // 24. SAVE RESULT
            // =========================================================
            await Actor.setValue(
                'HME_RCD_RESULT',
                {
                    success: true,

                    store,

                    report_date,

                    start_time:
                        `${start_hour}:${start_minute} ${start_ampm}`,

                    stop_time:
                        `${stop_hour}:${stop_minute} ${stop_ampm}`,

                    time_format,

                    include_pullins,

                    reportFrameUrl:
                        reportFrame.url(),

                    finalUrl:
                        page.url(),

                    timestamp:
                        new Date().toISOString(),
                }
            );


            await Actor.pushData({
                success: true,

                store,

                report_date,

                start_time:
                    `${start_hour}:${start_minute} ${start_ampm}`,

                stop_time:
                    `${stop_hour}:${stop_minute} ${stop_ampm}`,

                time_format,

                include_pullins,

                reportFrameUrl:
                    reportFrame.url(),

                finalUrl:
                    page.url(),

                timestamp:
                    new Date().toISOString(),
            });


            log.info(
                'HME RCD report parameters submitted successfully.'
            );

        } catch (error) {

            log.error(
                `HME RCD Actor failed: ${error.message}`
            );

            try {

                await saveScreenshot(
                    page,
                    'HME_RCD_FAILURE'
                );

                log.info(
                    'Saved screenshot: HME_RCD_FAILURE'
                );

            } catch (
                screenshotError
            ) {

                log.error(
                    `Could not save failure screenshot: ${screenshotError.message}`
                );
            }


            try {
                await Actor.setValue(
                    'HME_RCD_FAILURE_DETAILS',
                    {
                        error:
                            error.message,

                        url:
                            page.url(),

                        frames:
                            page.frames().map(
                                (frame, index) => ({
                                    index,
                                    url:
                                        frame.url(),
                                })
                            ),

                        timestamp:
                            new Date().toISOString(),
                    }
                );
            } catch {
                // Ignore if page has already been closed
            }

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

            await saveScreenshot(
                page,
                'HME_REQUEST_FAILURE'
            );

        } catch (
            screenshotError
        ) {

            log.error(
                `Could not save request failure screenshot: ${screenshotError.message}`
            );
        }
    },
});


// =====================================================================
// START ACTOR
// =====================================================================
await crawler.run([
    {
        url,
        uniqueKey:
            'HME_RCD_REPORT',
    },
]);

await Actor.exit();