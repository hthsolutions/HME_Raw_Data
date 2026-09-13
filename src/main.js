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
// HELPER: Save screenshot to default Apify Key-Value Store
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
// HELPER: Sanitize filename / record key
// =====================================================================

function sanitizeFileName(value) {
    return String(value)
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}


// =====================================================================
// HELPER: Select Fluent UI combobox
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
// HELPER: Find the frame containing the RCD report
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
                // 1. OPEN HME CLOUD
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
                // 8. STORE INPUT
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
                // 22. WAIT FOR EXPORT TEXT
                // =====================================================

                log.info(
                    'Waiting for report to load and Export control to become available...'
                );

                const exportText =
                    reportFrame
                        .getByText(
                            'Export',
                            {
                                exact:
                                    true,
                            }
                        )
                        .first();

                await exportText.waitFor({
                    state:
                        'visible',
                    timeout:
                        120000,
                });

                log.info(
                    'Export text is visible.'
                );


                // =====================================================
                // 23. FIND EXPORT BUTTON
                // =====================================================

                const exportButton =
                    exportText.locator(
                        'xpath=ancestor::button[1]'
                    );

                await exportButton.waitFor({
                    state:
                        'visible',
                    timeout:
                        30000,
                });

                log.info(
                    'Export button located.'
                );


                // =====================================================
                // 24. WAIT UNTIL EXPORT IS ENABLED
                // =====================================================

                const exportStartTime =
                    Date.now();

                let exportReady =
                    false;

                while (
                    Date.now() -
                        exportStartTime <
                    120000
                ) {

                    const disabled =
                        await exportButton
                            .isDisabled()
                            .catch(
                                () => true
                            );

                    const ariaDisabled =
                        await exportButton
                            .getAttribute(
                                'aria-disabled'
                            );

                    log.info(
                        `Export state -> disabled=${disabled}, aria-disabled=${ariaDisabled}`
                    );

                    if (
                        !disabled &&
                        ariaDisabled !==
                            'true'
                    ) {

                        exportReady =
                            true;

                        break;
                    }

                    await page.waitForTimeout(
                        1000
                    );
                }

                if (
                    !exportReady
                ) {

                    throw new Error(
                        'Export button remained disabled after report load.'
                    );
                }

                log.info(
                    'Export button is enabled. Report is ready.'
                );


                // =====================================================
                // 25. SCREENSHOT REPORT LOADED
                // =====================================================

                await saveScreenshot(
                    page,
                    'HME_RCD_REPORT_LOADED'
                );

                log.info(
                    'Saved screenshot: HME_RCD_REPORT_LOADED'
                );


                // =====================================================
                // 26. FIND EXPORT CHEVRON
                // =====================================================

                const exportChevron =
                    exportButton.locator(
                        'i[data-icon-name="ChevronDown"]'
                    );

                const chevronVisible =
                    await exportChevron
                        .isVisible()
                        .catch(
                            () => false
                        );


                // =====================================================
                // 27. OPEN EXPORT MENU
                // =====================================================

                log.info(
                    'Opening Export menu...'
                );

                if (
                    chevronVisible
                ) {

                    log.info(
                        'Export chevron found. Clicking dropdown arrow.'
                    );

                    await exportChevron.click();

                } else {

                    log.warning(
                        'Export chevron not found. Clicking Export button instead.'
                    );

                    await exportButton.click();
                }

                await page.waitForTimeout(
                    750
                );


                // =====================================================
                // 28. FIND CSV OPTION
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
                    await csvOption.count() ===
                    0
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
                // 29. START CSV DOWNLOAD
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
                // 30. WAIT FOR DOWNLOAD TO COMPLETE
                // =====================================================

                const downloadedPath =
                    await download.path();

                if (
                    !downloadedPath
                ) {

                    throw new Error(
                        'CSV download completed but Playwright did not return a file path.'
                    );
                }

                log.info(
                    `CSV downloaded to temporary path: ${downloadedPath}`
                );


                // =====================================================
                // 31. BUILD FINAL FILE / STORAGE NAME
                // =====================================================

                const safeDate =
                    report_date.replace(
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
                // 32. READ CSV
                // =====================================================

                const csvBuffer =
                    await fs.readFile(
                        downloadedPath
                    );


                // =====================================================
                // 33. OPEN NAMED APIFY KEY-VALUE STORE
                // =====================================================

                const hmeStore =
                    await Actor.openKeyValueStore(
                        'hthsolutions-hme-rcd'
                    );

                log.info(
                    'Opened Key-Value Store: hthsolutions-hme-rcd'
                );


                // =====================================================
                // 34. SAVE CSV
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
                    'CSV saved successfully to hthsolutions-hme-rcd'
                );

                log.info(
                    `Storage record key: ${recordKey}`
                );


                // =====================================================
                // 35. SAVE RESULT METADATA
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
                // 36. PUSH RESULT TO DATASET
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