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
    page,
    selector,
    value,
    log
) {
    const inputField = page.locator(selector);

    await inputField.waitFor({
        state: 'visible',
        timeout: 30000,
    });

    await inputField.click();

    // Clear anything currently in the field
    await inputField.fill('');

    // Type the desired value
    await inputField.fill(String(value));

    log.info(
        `Entered "${value}" into ${selector}`
    );

    // Give the Fluent UI dropdown a moment to render
    await page.waitForTimeout(750);

    // Try to find an exact matching option
    const exactOption = page
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
        // Fallback for comboboxes that accept typed values
        log.warning(
            `Exact option "${value}" not found. ` +
            'Using Enter as fallback.'
        );

        await inputField.press('Enter');
    }

    // Wait briefly for React state to update
    await page.waitForTimeout(500);
}


// =====================================================================
// HELPER: Wait until a field becomes enabled
// =====================================================================
async function waitUntilEnabled(
    page,
    selector,
    timeout = 60000
) {
    await page.waitForFunction(
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
// CRAWLER
// =====================================================================
const crawler = new PlaywrightCrawler({

    maxRequestsPerCrawl: 1,

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


            // =========================================================
            // 6. WAIT FOR RCD REPORT PAGE
            //
            // Instead of checking only the URL, wait for the Store
            // selector. This confirms that the actual RCD report page
            // has loaded.
            // =========================================================
            const storeSelector =
                '#P_STORE_ID-input';

            const storeInput =
                page.locator(
                    storeSelector
                );

            log.info(
                'Waiting for RCD report page to load...'
            );

            await storeInput.waitFor({
                state: 'visible',
                timeout: 60000,
            });

            log.info(
                'RCD report page loaded successfully.'
            );

            log.info(
                `Current URL: ${page.url()}`
            );


            await saveScreenshot(
                page,
                'HME_RCD_PAGE_LOADED'
            );


            // =========================================================
            // 7. SELECT STORE
            // =========================================================
            log.info(
                `Selecting store: ${store}`
            );

            await selectCombobox(
                page,
                storeSelector,
                store,
                log
            );

            log.info(
                `Store selected: ${store}`
            );


            // =========================================================
            // 8. ENTER REPORT DATE
            // =========================================================
            const dateInput =
                page.locator(
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

            // You mentioned HME requires Enter here in order
            // to activate/load the remaining fields.
            await dateInput.press(
                'Enter'
            );

            log.info(
                'Date entered. Waiting for time fields to become enabled...'
            );


            // =========================================================
            // 9. WAIT FOR DATE-DEPENDENT CONTROLS
            // =========================================================
            await waitUntilEnabled(
                page,
                '#P_HOUR_INI-input',
                60000
            );

            log.info(
                'Start-time fields are now enabled.'
            );

            // Give HME a little extra time to finish populating
            // all dependent controls.
            await page.waitForTimeout(
                1500
            );


            // =========================================================
            // 10. START HOUR
            // =========================================================
            log.info(
                `Selecting start hour: ${start_hour}`
            );

            await selectCombobox(
                page,
                '#P_HOUR_INI-input',
                start_hour,
                log
            );


            // =========================================================
            // 11. START MINUTE
            // =========================================================
            log.info(
                `Selecting start minute: ${start_minute}`
            );

            await selectCombobox(
                page,
                '#P_MINUTE_INI-input',
                start_minute,
                log
            );


            // =========================================================
            // 12. START AM / PM
            // =========================================================
            log.info(
                `Selecting start AM/PM: ${start_ampm}`
            );

            await selectCombobox(
                page,
                '#P_AMPM_INI-input',
                start_ampm,
                log
            );


            // =========================================================
            // 13. STOP HOUR
            // =========================================================
            log.info(
                `Selecting stop hour: ${stop_hour}`
            );

            await selectCombobox(
                page,
                '#P_HOUR_END-input',
                stop_hour,
                log
            );


            // =========================================================
            // 14. STOP MINUTE
            // =========================================================
            log.info(
                `Selecting stop minute: ${stop_minute}`
            );

            await selectCombobox(
                page,
                '#P_MINUTE_END-input',
                stop_minute,
                log
            );


            // =========================================================
            // 15. STOP AM / PM
            // =========================================================
            log.info(
                `Selecting stop AM/PM: ${stop_ampm}`
            );

            await selectCombobox(
                page,
                '#P_AMPM_END-input',
                stop_ampm,
                log
            );


            // =========================================================
            // 16. TIME FORMAT
            // =========================================================
            log.info(
                `Selecting time format: ${time_format}`
            );

            await selectCombobox(
                page,
                '#P_FORMAT_TIME-input',
                time_format,
                log
            );


            // =========================================================
            // 17. INCLUDE PULLINS
            // =========================================================
            log.info(
                `Selecting Include Pullins: ${include_pullins}`
            );

            await selectCombobox(
                page,
                '#P_PULLINS-input',
                include_pullins,
                log
            );


            // =========================================================
            // 18. SCREENSHOT BEFORE VIEW REPORT
            // =========================================================
            await saveScreenshot(
                page,
                'HME_RCD_PARAMETERS_COMPLETE'
            );

            log.info(
                'Saved screenshot: HME_RCD_PARAMETERS_COMPLETE'
            );


            // =========================================================
            // 19. CLICK VIEW REPORT
            // =========================================================
            const viewReportButton =
                page.getByText(
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
            // 20. WAIT FOR REPORT TO BEGIN LOADING
            // =========================================================
            await page.waitForTimeout(
                5000
            );

            log.info(
                'View report clicked.'
            );

            log.info(
                `URL after View report: ${page.url()}`
            );


            // =========================================================
            // 21. SCREENSHOT AFTER VIEW REPORT
            // =========================================================
            await saveScreenshot(
                page,
                'HME_AFTER_VIEW_REPORT'
            );

            log.info(
                'Saved screenshot: HME_AFTER_VIEW_REPORT'
            );


            // =========================================================
            // 22. SAVE RUN INFORMATION
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

                finalUrl:
                    page.url(),

                timestamp:
                    new Date().toISOString(),
            });


            log.info(
                'HME RCD report parameters submitted successfully.'
            );

        } catch (error) {

            // =========================================================
            // FAILURE DEBUGGING
            // =========================================================
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


            await Actor.setValue(
                'HME_RCD_FAILURE_DETAILS',
                {
                    error:
                        error.message,

                    url:
                        page.url(),

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