import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import fs from 'node:fs/promises';

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


// =====================================================================
// INPUT VALIDATION
// =====================================================================
if (!username || !password) {
    throw new Error(
        'Both username and password are required.'
    );
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
// HELPER: Sanitize filename / storage key
// =====================================================================
function sanitizeFileName(value) {
    return String(value)
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
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
    const inputField =
        frame.locator(selector);

    await inputField.waitFor({
        state: 'visible',
        timeout: 30000,
    });

    await inputField.click();

    await inputField.fill('');

    await inputField.fill(
        String(value)
    );

    log.info(
        `Entered "${value}" into ${selector}`
    );

    await frame.page().waitForTimeout(
        750
    );

    const exactOption =
        frame
            .getByRole(
                'option',
                {
                    name: String(value),
                    exact: true,
                }
            )
            .last();

    const optionVisible =
        await exactOption
            .isVisible()
            .catch(() => false);

    if (optionVisible) {

        await exactOption.click();

        log.info(
            `Selected dropdown option "${value}".`
        );

    } else {

        log.warning(
            `Exact dropdown option "${value}" not found. Using Enter as fallback.`
        );

        await inputField.press(
            'Enter'
        );
    }

    await frame.page().waitForTimeout(
        500
    );
}


// =====================================================================
// HELPER: Wait until a field becomes enabled
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
// HELPER: Wait until a button becomes enabled
// =====================================================================
async function waitForButtonEnabled(
    locator,
    log,
    timeout = 120000
) {
    const startTime =
        Date.now();

    while (
        Date.now() - startTime < timeout
    ) {

        const visible =
            await locator
                .isVisible()
                .catch(() => false);

        const enabled =
            await locator
                .isEnabled()
                .catch(() => false);

        if (
            visible &&
            enabled
        ) {

            log.info(
                'Button is visible and enabled.'
            );

            return;
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1000
                )
        );
    }

    throw new Error(
        `Button did not become enabled within ${timeout / 1000} seconds.`
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
    const startTime =
        Date.now();

    while (
        Date.now() - startTime < timeout
    ) {

        const frames =
            page.frames();

        log.info(
            `Searching ${frames.length} frame(s) for RCD Store combobox...`
        );

        for (
            let i = 0;
            i < frames.length;
            i++
        ) {

            const frame =
                frames[i];

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

                if (
                    roleCount > 0
                ) {

                    log.info(
                        `RCD Store combobox found in frame ${i}: ${frame.url()}`
                    );

                    return frame;
                }


                const storeById =
                    frame.locator(
                        '#P_STORE_ID-input'
                    );

                const idCount =
                    await storeById.count();

                if (
                    idCount > 0
                ) {

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

        await page.waitForTimeout(
            1000
        );
    }

    throw new Error(
        'Could not locate the RCD Store combobox in any page frame.'
    );
}


// =====================================================================
// CRAWLER
// =====================================================================
const crawler =
    new PlaywrightCrawler({

        maxRequestsPerCrawl: 1,

        maxRequestRetries: 0,

        requestHandlerTimeoutSecs: 300,

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

                // =====================================================
                // 1. OPEN HME RCD PAGE
                // =====================================================
                await page.goto(
                    request.url,
                    {
                        waitUntil:
                            'domcontentloaded',
                        timeout:
                            60000,
                    }
                );

                log.info(
                    `Initial URL: ${page.url()}`
                );


                // =====================================================
                // 2. USERNAME
                // =====================================================
                const usernameInput =
                    page.locator(
                        'input[name="username"]'
                    );

                await usernameInput.waitFor({
                    state:
                        'visible',
                    timeout:
                        30000,
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


                // =====================================================
                // 3. CONTINUE
                // =====================================================
                const continueButton =
                    page.locator(
                        'button[name="intent"][value="verify"]'
                    );

                await continueButton.waitFor({
                    state:
                        'visible',
                    timeout:
                        15000,
                });

                log.info(
                    'Clicking Continue...'
                );

                await continueButton.click();


                // =====================================================
                // 4. PASSWORD
                // =====================================================
                const passwordInput =
                    page.locator(
                        'input[name="password"]'
                    );

                await passwordInput.waitFor({
                    state:
                        'visible',
                    timeout:
                        30000,
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


                // =====================================================
                // 5. LOGIN
                // =====================================================
                const loginButton =
                    page.locator(
                        'button[name="intent"][value="login"]'
                    );

                await loginButton.waitFor({
                    state:
                        'visible',
                    timeout:
                        15000,
                });

                log.info(
                    'Clicking Login...'
                );

                await loginButton.click();

                await page.waitForTimeout(
                    3000
                );

                log.info(
                    `URL after login click: ${page.url()}`
                );


                // =====================================================
                // 6. SCREENSHOT AFTER LOGIN
                // =====================================================
                await saveScreenshot(
                    page,
                    'HME_AFTER_LOGIN_CLICK'
                );

                log.info(
                    'Saved screenshot: HME_AFTER_LOGIN_CLICK'
                );


                // =====================================================
                // 7. FIND REPORT FRAME
                // =====================================================
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


                // =====================================================
                // 8. FIND STORE INPUT
                // =====================================================
                let storeInput =
                    reportFrame.getByRole(
                        'combobox',
                        {
                            name:
                                'Store:',
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
                    state:
                        'visible',
                    timeout:
                        30000,
                });

                log.info(
                    'RCD Store selector is visible.'
                );


                // =====================================================
                // 9. SELECT STORE
                // =====================================================
                log.info(
                    `Selecting store: ${store}`
                );

                await storeInput.click();

                await storeInput.fill(
                    ''
                );

                await storeInput.fill(
                    store
                );

                await page.waitForTimeout(
                    750
                );

                const storeOption =
                    reportFrame
                        .getByRole(
                            'option',
                            {
                                name:
                                    store,
                                exact:
                                    true,
                            }
                        )
                        .last();

                if (
                    await storeOption
                        .isVisible()
                        .catch(
                            () => false
                        )
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


                // =====================================================
                // 10. DATE
                // =====================================================
                const dateInput =
                    reportFrame.locator(
                        'input[aria-label="Date (MM/DD/YYYY):"]'
                    );

                await dateInput.waitFor({
                    state:
                        'visible',
                    timeout:
                        30000,
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
                    'Date entered. Waiting for time fields...'
                );


                // =====================================================
                // 11. WAIT FOR TIME FIELDS
                // =====================================================
                await waitUntilEnabled(
                    reportFrame,
                    '#P_HOUR_INI-input',
                    60000
                );

                log.info(
                    'Time controls are now enabled.'
                );

                await page.waitForTimeout(
                    1000
                );


                // =====================================================
                // 12. START HOUR
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_HOUR_INI-input',
                    start_hour,
                    log
                );


                // =====================================================
                // 13. START MINUTE
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_MINUTE_INI-input',
                    start_minute,
                    log
                );


                // =====================================================
                // 14. START AM/PM
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_AMPM_INI-input',
                    start_ampm,
                    log
                );


                // =====================================================
                // 15. STOP HOUR
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_HOUR_END-input',
                    stop_hour,
                    log
                );


                // =====================================================
                // 16. STOP MINUTE
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_MINUTE_END-input',
                    stop_minute,
                    log
                );


                // =====================================================
                // 17. STOP AM/PM
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_AMPM_END-input',
                    stop_ampm,
                    log
                );


                // =====================================================
                // 18. TIME FORMAT
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_FORMAT_TIME-input',
                    time_format,
                    log
                );


                // =====================================================
                // 19. INCLUDE PULLINS
                // =====================================================
                await selectCombobox(
                    reportFrame,
                    '#P_PULLINS-input',
                    include_pullins,
                    log
                );


                // =====================================================
                // 20. SCREENSHOT PARAMETERS
                // =====================================================
                await saveScreenshot(
                    page,
                    'HME_RCD_PARAMETERS_COMPLETE'
                );

                log.info(
                    'Saved screenshot: HME_RCD_PARAMETERS_COMPLETE'
                );


                // =====================================================
                // 21. VIEW REPORT
                // =====================================================
                const viewReportButton =
                    reportFrame.getByText(
                        'View report',
                        {
                            exact:
                                true,
                        }
                    );

                await viewReportButton.waitFor({
                    state:
                        'visible',
                    timeout:
                        30000,
                });

                log.info(
                    'Clicking View report...'
                );

                await viewReportButton.click();


                // =====================================================
                // 22. WAIT FOR EXPORT BUTTON
                // =====================================================
                log.info(
                    'Waiting for report to load and Export to become enabled...'
                );

                const exportButton =
                    reportFrame
                        .getByRole(
                            'button',
                            {
                                name:
                                    /Export/i,
                            }
                        )
                        .first();

                await exportButton.waitFor({
                    state:
                        'visible',
                    timeout:
                        120000,
                });

                log.info(
                    'Export button found. Waiting for it to become enabled...'
                );


                // =====================================================
                // 23. WAIT UNTIL EXPORT IS ENABLED
                // =====================================================
                await waitForButtonEnabled(
                    exportButton,
                    log,
                    120000
                );

                log.info(
                    'Export button is enabled. Report is ready.'
                );


                // =====================================================
                // 24. SCREENSHOT REPORT LOADED
                // =====================================================
                await saveScreenshot(
                    page,
                    'HME_RCD_REPORT_LOADED'
                );

                log.info(
                    'Saved screenshot: HME_RCD_REPORT_LOADED'
                );


                // =====================================================
                // 25. CLICK EXPORT
                // =====================================================
                await exportButton.click();

                log.info(
                    'Clicked Export.'
                );

                await page.waitForTimeout(
                    500
                );


                // =====================================================
                // 26. FIND CSV OPTION
                // =====================================================
                let csvOption =
                    reportFrame.getByText(
                        'Comma Separated Values (.csv)',
                        {
                            exact:
                                true,
                        }
                    );

                if (
                    await csvOption.count() === 0
                ) {

                    csvOption =
                        page.getByText(
                            'Comma Separated Values (.csv)',
                            {
                                exact:
                                    true,
                            }
                        );
                }

                await csvOption.waitFor({
                    state:
                        'visible',
                    timeout:
                        30000,
                });

                log.info(
                    'CSV export option found.'
                );


                // =====================================================
                // 27. DOWNLOAD CSV
                // =====================================================
                log.info(
                    'Selecting CSV export...'
                );

                const downloadPromise =
                    page.waitForEvent(
                        'download',
                        {
                            timeout:
                                120000,
                        }
                    );

                await csvOption.click();

                const download =
                    await downloadPromise;

                log.info(
                    `CSV download started. Browser filename: ${download.suggestedFilename()}`
                );


                // =====================================================
                // 28. WAIT FOR DOWNLOAD PATH
                // =====================================================
                const downloadedPath =
                    await download.path();

                if (
                    !downloadedPath
                ) {

                    throw new Error(
                        'CSV download completed but no file path was returned.'
                    );
                }

                log.info(
                    `CSV downloaded to temporary path: ${downloadedPath}`
                );


                // =====================================================
                // 29. BUILD SAFE FILE NAME
                // =====================================================
                const safeDate =
                    report_date
                        .replace(
                            /\//g,
                            '-'
                        );

                const safeStore =
                    sanitizeFileName(
                        store
                    );

                const fileName =
                    `${safeStore} - ${safeDate}.csv`;

                const recordKey =
                    `${safeStore} - ${safeDate}`;

                log.info(
                    `Final CSV filename: ${fileName}`
                );


                // =====================================================
                // 30. READ CSV
                // =====================================================
                const csvBuffer =
                    await fs.readFile(
                        downloadedPath
                    );


                // =====================================================
                // 31. OPEN NAMED STORAGE
                // =====================================================
                const hmeStore =
                    await Actor.openKeyValueStore(
                        'hthsolutions-hme-rcd'
                    );

                log.info(
                    'Opened Key-Value Store: hthsolutions-hme-rcd'
                );


                // =====================================================
                // 32. SAVE CSV
                // =====================================================
                await hmeStore.setValue(
                    recordKey,
                    csvBuffer,
                    {
                        contentType:
                            'text/csv; charset=utf-8',
                    }
                );

                log.info(
                    `CSV saved successfully to hthsolutions-hme-rcd`
                );

                log.info(
                    `Storage record key: ${recordKey}`
                );


                // =====================================================
                // 33. SAVE RESULT METADATA
                // =====================================================
                await Actor.setValue(
                    'HME_RCD_RESULT',
                    {
                        success:
                            true,

                        store,

                        report_date,

                        start_time:
                            `${start_hour}:${start_minute} ${start_ampm}`,

                        stop_time:
                            `${stop_hour}:${stop_minute} ${stop_ampm}`,

                        time_format,

                        include_pullins,

                        storage:
                            'hthsolutions-hme-rcd',

                        recordKey,

                        fileName,

                        originalFileName:
                            download.suggestedFilename(),

                        reportFrameUrl:
                            reportFrame.url(),

                        finalUrl:
                            page.url(),

                        timestamp:
                            new Date().toISOString(),
                    }
                );


                // =====================================================
                // 34. PUSH RESULT TO DATASET
                // =====================================================
                await Actor.pushData({
                    success:
                        true,

                    store,

                    report_date,

                    start_time:
                        `${start_hour}:${start_minute} ${start_ampm}`,

                    stop_time:
                        `${stop_hour}:${stop_minute} ${stop_ampm}`,

                    storage:
                        'hthsolutions-hme-rcd',

                    recordKey,

                    fileName,

                    timestamp:
                        new Date().toISOString(),
                });


                log.info(
                    'HME RCD CSV export completed successfully.'
                );

            } catch (error) {

                // =====================================================
                // FAILURE HANDLING
                // =====================================================
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
                                    (
                                        frame,
                                        index
                                    ) => ({
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
                    // Ignore secondary failure
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