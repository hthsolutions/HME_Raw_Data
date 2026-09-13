import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import fs from 'node:fs/promises';

await Actor.init();

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
) {
    throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
    );
}


const input = await Actor.getInput();

const {
    url = 'https://hmecloud.com/new-reports/rcd',

    username,
    password,

    store = '(Ungrouped) 11312 Leander - Other',

    store_key_values = [],

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

if (
    !Array.isArray(store_key_values) ||
    store_key_values.length === 0
) {
    throw new Error(
        'store_key_values must contain at least one configured store value.'
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
// HELPER: Match HME Store value against configured store_key_values
// =====================================================================

function getStoreKey(
    storeValue,
    storeKeyValues
) {
    const storeUpper =
        String(storeValue)
            .toUpperCase();

    const match =
        storeKeyValues.find(
            value =>
                storeUpper.includes(
                    String(value).toUpperCase()
                )
        );

    if (!match) {
        throw new Error(
            `No store key match found for "${storeValue}". ` +
            `Configured values: ${storeKeyValues.join(', ')}`
        );
    }

    return String(match)
        .toUpperCase()
        .trim();
}


// =====================================================================
// HELPER: Remove HME report metadata above actual RCD data
// =====================================================================

function cleanHmeRcdCsv(
    csvBuffer,
    log
) {

    let csvText =
        csvBuffer.toString('utf8');

    // Remove UTF-8 BOM if present
    csvText =
        csvText.replace(
            /^\uFEFF/,
            ''
        );

    const lines =
        csvText.split(
            /\r?\n/
        );

    // Find actual Raw Car Data table header
    const headerIndex =
        lines.findIndex(
            line => {

                const upper =
                    line.toUpperCase();

                return (
                    upper.includes(
                        'DAYPART'
                    ) &&
                    upper.includes(
                        'DEPARTURE_TIME'
                    ) &&
                    upper.includes(
                        'EVENT_NAME'
                    ) &&
                    upper.includes(
                        'EVENTTYPE'
                    ) &&
                    upper.includes(
                        'AVGTIME'
                    )
                );
            }
        );

    if (
        headerIndex === -1
    ) {
        throw new Error(
            'Could not locate the RCD data header in the downloaded CSV.'
        );
    }

    log.info(
        `RCD data header found at CSV row ${headerIndex + 1}.`
    );

    log.info(
        `Removing ${headerIndex} metadata/blank row(s) above the dataset.`
    );

    const cleanedLines =
        lines.slice(
            headerIndex
        );

    while (
        cleanedLines.length > 0 &&
        cleanedLines[
            cleanedLines.length - 1
        ].trim() === ''
    ) {
        cleanedLines.pop();
    }

    const cleanedCsv =
        cleanedLines.join(
            '\r\n'
        );

    return Buffer.from(
        cleanedCsv,
        'utf8'
    );
}


// =====================================================================
// HELPER: Parse a CSV row while respecting quoted commas
// =====================================================================

function parseCsvRow(line) {
    const values = [];

    let current = '';
    let insideQuotes = false;

    for (
        let i = 0;
        i < line.length;
        i++
    ) {

        const char =
            line[i];

        if (
            char === '"'
        ) {

            if (
                insideQuotes &&
                line[i + 1] === '"'
            ) {

                current += '"';

                i++;

            } else {

                insideQuotes =
                    !insideQuotes;
            }

        } else if (
            char === ',' &&
            !insideQuotes
        ) {

            values.push(
                current
            );

            current = '';

        } else {

            current += char;
        }
    }

    values.push(
        current
    );

    return values;
}


// =====================================================================
// HELPER: Escape value for CSV output
// =====================================================================

function escapeCsvValue(value) {
    const stringValue =
        String(
            value ?? ''
        );

    if (
        stringValue.includes(',') ||
        stringValue.includes('"') ||
        stringValue.includes('\n') ||
        stringValue.includes('\r')
    ) {

        return `"${stringValue.replace(
            /"/g,
            '""'
        )}"`;
    }

    return stringValue;
}


// =====================================================================
// HELPER: Add StoreLocation column to cleaned CSV
// =====================================================================

function addStoreLocationColumn(
    csvBuffer,
    storeLocation,
    log
) {
    const csvText =
        csvBuffer.toString(
            'utf8'
        );

    const lines =
        csvText
            .split(/\r?\n/)
            .filter(
                line =>
                    line.trim() !== ''
            );

    if (
        lines.length === 0
    ) {
        throw new Error(
            'Cannot add StoreLocation because cleaned CSV is empty.'
        );
    }

    const headers =
        parseCsvRow(
            lines[0]
        )
            .map(
                value =>
                    value.trim()
            );

    if (
        headers.includes(
            'StoreLocation'
        )
    ) {

        log.warning(
            'StoreLocation column already exists. Skipping StoreLocation insertion.'
        );

        return csvBuffer;
    }

    const updatedLines = [];

    // Add StoreLocation as first column
    updatedLines.push(
        `StoreLocation,${lines[0]}`
    );

    // Add StoreLocation to every data row
    for (
        let i = 1;
        i < lines.length;
        i++
    ) {

        updatedLines.push(
            `${escapeCsvValue(storeLocation)},${lines[i]}`
        );
    }

    const updatedCsv =
        updatedLines.join(
            '\r\n'
        );

    log.info(
        `Added StoreLocation="${storeLocation}" to ${lines.length - 1} data row(s).`
    );

    return Buffer.from(
        updatedCsv,
        'utf8'
    );
}


// =====================================================================
// HELPER: Validate HME queue fields
// =====================================================================

function validateHmeQueueFields(
    csvBuffer,
    log
) {
    const csvText =
        csvBuffer.toString(
            'utf8'
        );

    const lines =
        csvText
            .split(/\r?\n/)
            .filter(
                line =>
                    line.trim() !== ''
            );

    if (
        lines.length < 2
    ) {
        throw new Error(
            'Cleaned HME CSV contains no data rows.'
        );
    }


    // -------------------------------------------------------------
    // Parse header
    // -------------------------------------------------------------

    const headers =
        parseCsvRow(
            lines[0]
        )
            .map(
                value =>
                    value.trim()
            );


    const orderQueueIndex =
        headers.indexOf(
            'CarsInOrderQueue'
        );

    const orderPointStackIndex =
        headers.indexOf(
            'CarsInOrderPointStack'
        );

    const departureTimeIndex =
        headers.indexOf(
            'Departure_Time'
        );


    // -------------------------------------------------------------
    // Ensure expected columns exist
    // -------------------------------------------------------------

    if (
        orderQueueIndex === -1
    ) {
        throw new Error(
            'CarsInOrderQueue column was not found in the HME RCD CSV.'
        );
    }

    if (
        orderPointStackIndex === -1
    ) {
        throw new Error(
            'CarsInOrderPointStack column was not found in the HME RCD CSV.'
        );
    }


    // -------------------------------------------------------------
    // Find offending rows
    // -------------------------------------------------------------

    const offendingRows = [];

    for (
        let i = 1;
        i < lines.length;
        i++
    ) {

        const row =
            parseCsvRow(
                lines[i]
            );

        const carsInOrderQueue =
            String(
                row[
                    orderQueueIndex
                ] ?? ''
            ).trim();

        const carsInOrderPointStack =
            String(
                row[
                    orderPointStackIndex
                ] ?? ''
            ).trim();


        // Blank and zero are acceptable
        const queueHasValue =
            carsInOrderQueue !== '' &&
            Number(
                carsInOrderQueue
            ) !== 0;

        const stackHasValue =
            carsInOrderPointStack !== '' &&
            Number(
                carsInOrderPointStack
            ) !== 0;


        if (
            queueHasValue ||
            stackHasValue
        ) {

            offendingRows.push({
                csvRow:
                    i + 1,

                Departure_Time:
                    departureTimeIndex !== -1
                        ? row[
                            departureTimeIndex
                        ] ?? ''
                        : '',

                CarsInOrderQueue:
                    carsInOrderQueue,

                CarsInOrderPointStack:
                    carsInOrderPointStack,
            });
        }
    }


    // -------------------------------------------------------------
    // Fail Actor if queue/stack values exist
    // -------------------------------------------------------------

    if (
        offendingRows.length > 0
    ) {

        log.error(
            'HME RCD VALIDATION FAILED: ' +
            `${offendingRows.length} row(s) contain non-zero values in ` +
            'CarsInOrderQueue and/or CarsInOrderPointStack.'
        );


        for (
            const row of offendingRows
        ) {

            log.error(
                `Queue/Stack detected | ` +
                `CSV Row=${row.csvRow} | ` +
                `Departure_Time=${row.Departure_Time} | ` +
                `CarsInOrderQueue=${row.CarsInOrderQueue || '(blank)'} | ` +
                `CarsInOrderPointStack=${row.CarsInOrderPointStack || '(blank)'}`
            );
        }


        throw new Error(
            'HME RCD data contains non-zero CarsInOrderQueue and/or ' +
            'CarsInOrderPointStack values. Actor terminated without saving CSV.'
        );
    }


    log.info(
        'HME RCD queue validation passed: ' +
        'CarsInOrderQueue and CarsInOrderPointStack contain no non-zero values.'
    );
}

function normalizeDepartureTime(value) {
    const input =
        String(value ?? '').trim();

    if (!input) {
        return null;
    }

    const match =
        input.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i
        );

    if (!match) {
        throw new Error(
            `Unexpected Departure_Time format: "${input}"`
        );
    }

    let [
        ,
        month,
        day,
        year,
        hour,
        minute,
        second,
        ampm
    ] = match;

    let hour24 =
        Number(hour);

    const upperAmPm =
        ampm.toUpperCase();

    if (
        upperAmPm === 'PM' &&
        hour24 !== 12
    ) {
        hour24 += 12;
    }

    if (
        upperAmPm === 'AM' &&
        hour24 === 12
    ) {
        hour24 = 0;
    }

    return (
        `${year}-` +
        `${String(month).padStart(2, '0')}-` +
        `${String(day).padStart(2, '0')} ` +
        `${String(hour24).padStart(2, '0')}:` +
        `${minute}:` +
        `${second}`
    );
}

function pivotHmeRcdCsv(
    csvBuffer,
    log
) {
    const csvText =
        csvBuffer.toString('utf8');

    const lines =
        csvText
            .split(/\r?\n/)
            .filter(
                line =>
                    line.trim() !== ''
            );

    if (lines.length < 2) {
        throw new Error(
            'No HME data rows available for pivot.'
        );
    }

    const headers =
        parseCsvRow(lines[0])
            .map(
                value =>
                    value.trim()
            );

    const getIndex =
        columnName => {

            const index =
                headers.indexOf(
                    columnName
                );

            if (index === -1) {
                throw new Error(
                    `Required column "${columnName}" was not found.`
                );
            }

            return index;
        };


    const storeLocationIndex =
        getIndex(
            'StoreLocation'
        );

    const departureTimeIndex =
        getIndex(
            'Departure_Time'
        );

    const eventNameIndex =
        getIndex(
            'Event_Name'
        );

    const totalCarsIndex =
        getIndex(
            'Total_Cars'
        );

    const eventTypeIndex =
        getIndex(
            'EventType'
        );

    const avgTimeIndex =
        getIndex(
            'AvgTime'
        );


    const groups =
        new Map();


    for (
        let i = 1;
        i < lines.length;
        i++
    ) {

        const row =
            parseCsvRow(
                lines[i]
            );


        const storeLocation =
            String(
                row[
                    storeLocationIndex
                ] ?? ''
            ).trim();


        const departureTimeRaw =
            String(
                row[
                    departureTimeIndex
                ] ?? ''
            ).trim();


        const eventName =
            String(
                row[
                    eventNameIndex
                ] ?? ''
            ).trim();


        if (
            eventName !==
            'Car_Departure'
        ) {
            continue;
        }


        const eventType =
            String(
                row[
                    eventTypeIndex
                ] ?? ''
            )
                .trim()
                .toLowerCase()
                .replace(
                    /\s+/g,
                    ''
                );


        const avgTimeRaw =
            String(
                row[
                    avgTimeIndex
                ] ?? ''
            ).trim();


        const totalCarsRaw =
            String(
                row[
                    totalCarsIndex
                ] ?? ''
            ).trim();


        const avgTime =
            avgTimeRaw === ''
                ? null
                : Number(avgTimeRaw);


        const totalCars =
            totalCarsRaw === ''
                ? null
                : Number(totalCarsRaw);


        const departureTime =
            normalizeDepartureTime(
                departureTimeRaw
            );


        const groupKey =
            `${storeLocation}|${departureTime}`;


        if (
            !groups.has(
                groupKey
            )
        ) {

            groups.set(
                groupKey,
                {
                    primary_key:
                        groupKey,

                    StoreLocation:
                        storeLocation,

                    Departure_Time:
                        departureTime,

                    Event_Name:
                        eventName,

                    Total_Cars:
                        totalCars,

                    Menu_Board:
                        null,

                    Greet:
                        null,

                    Service:
                        null,

                    Lane_Queue:
                        null,

                    Lane_Total_Raw:
                        null,

                    eventCounts: {},
                }
            );
        }


        const group =
            groups.get(
                groupKey
            );


        group.Total_Cars =
            totalCars;


        group.eventCounts[
            eventType
        ] =
            (
                group.eventCounts[
                    eventType
                ] ?? 0
            ) + 1;


        switch (
            eventType
        ) {

            case 'menuboard':
                group.Menu_Board =
                    avgTime;
                break;

            case 'greet':
                group.Greet =
                    avgTime;
                break;

            case 'service':
                group.Service =
                    avgTime;
                break;

            case 'lanequeue':
                group.Lane_Queue =
                    avgTime;
                break;

            case 'lanetotal':
                group.Lane_Total_Raw =
                    avgTime;
                break;
        }
    }


    const records = [];


    for (
        const group of
        groups.values()
    ) {

        const duplicateEvents =
            Object.entries(
                group.eventCounts
            )
                .filter(
                    ([, count]) =>
                        count > 1
                );


        if (
            duplicateEvents.length > 0
        ) {

            throw new Error(
                `Duplicate HME event rows detected for ${group.primary_key}: ` +
                duplicateEvents
                    .map(
                        ([type, count]) =>
                            `${type}=${count}`
                    )
                    .join(', ')
            );
        }


        const calculatedLaneTotal =
            (
                group.Lane_Queue ?? 0
            ) +
            (
                group.Menu_Board ?? 0
            ) +
            (
                group.Service ?? 0
            );


        const laneTotal =
            group.Lane_Total_Raw ===
            calculatedLaneTotal
                ? group.Lane_Total_Raw
                : null;


        if (
            laneTotal === null
        ) {

            log.warning(
                `Lane_Total validation failed for ${group.primary_key}. ` +
                `Raw=${group.Lane_Total_Raw}, ` +
                `Calculated=${calculatedLaneTotal}`
            );
        }


        records.push({
            primary_key:
                group.primary_key,

            StoreLocation:
                group.StoreLocation,

            Departure_Time:
                group.Departure_Time,

            Event_Name:
                group.Event_Name,

            Total_Cars:
                group.Total_Cars,

            Menu_Board:
                group.Menu_Board,

            Greet:
                group.Greet,

            Service:
                group.Service,

            Lane_Queue:
                group.Lane_Queue,

            Lane_Total:
                laneTotal,
        });
    }


    log.info(
        `Pivoted ${lines.length - 1} HME event rows into ${records.length} car records.`
    );


    return records;
}

async function upsertHmeRowsToSupabase(
    records,
    log
) {
    if (
        records.length === 0
    ) {

        log.warning(
            'No HME records available for Supabase upsert.'
        );

        return;
    }


    const tableName =
        'daily-hme-rcd-summary';


    const url =
        `${SUPABASE_URL}/rest/v1/${encodeURIComponent(tableName)}?on_conflict=primary_key`;


    const response =
        await fetch(
            url,
            {
                method:
                    'POST',

                headers: {
                    'Content-Type':
                        'application/json',

                    'apikey':
                        SUPABASE_SERVICE_ROLE_KEY,

                    'Authorization':
                        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

                    'Prefer':
                        'resolution=merge-duplicates,return=minimal',
                },

                body:
                    JSON.stringify(
                        records
                    ),
            }
        );


    if (
        !response.ok
    ) {

        const errorText =
            await response.text();

        throw new Error(
            `Supabase upsert failed (${response.status}): ${errorText}`
        );
    }


    log.info(
        `Successfully upserted ${records.length} HME records into ${tableName}.`
    );
}



// =====================================================================
// CRAWLER
// =====================================================================

const crawler =
    new PlaywrightCrawler({

        maxRequestsPerCrawl: 1,

        maxRequestRetries: 0,

        requestHandlerTimeoutSecs:
            300,

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
                // 31. MATCH STORE KEY
                // =====================================================

                const storeKey =
                    getStoreKey(
                        store,
                        store_key_values
                    );

                log.info(
                    `Matched StoreLocation: ${storeKey}`
                );


                // =====================================================
                // 32. BUILD FINAL FILE / STORAGE NAME
                // =====================================================

                const safeStoreKey =
                    sanitizeFileName(
                        storeKey
                    );

                const [
                    month,
                    day,
                    year
                ] =
                    report_date.split(
                        '/'
                    );

                const storageDate =
                    `${year}-${month}-${day}`;

                const fileName =
                    `${safeStoreKey}_${storageDate}.csv`;

                const recordKey =
                    fileName;

                log.info(
                    `Final CSV filename: ${fileName}`
                );


                // =====================================================
                // 33. READ RAW CSV
                // =====================================================

                const rawCsvBuffer =
                    await fs.readFile(
                        downloadedPath
                    );

                log.info(
                    `Raw CSV downloaded: ${rawCsvBuffer.length} bytes`
                );


                // =====================================================
                // 34. CLEAN HME CSV
                // =====================================================

                const cleanedCsvBuffer =
                    cleanHmeRcdCsv(
                        rawCsvBuffer,
                        log
                    );

                log.info(
                    `Cleaned CSV created: ${cleanedCsvBuffer.length} bytes`
                );


                // =====================================================
                // 35. ADD STORELOCATION
                // =====================================================

                log.info(
                    `Adding StoreLocation column using matched store key: ${storeKey}`
                );

                const csvBuffer =
                    addStoreLocationColumn(
                        cleanedCsvBuffer,
                        storeKey,
                        log
                    );

                log.info(
                    `StoreLocation column added. Final CSV size: ${csvBuffer.length} bytes`
                );


                // =====================================================
                // 36. VALIDATE QUEUE / STACK DATA
                // =====================================================

                log.info(
                    'Checking CarsInOrderQueue and CarsInOrderPointStack...'
                );

                validateHmeQueueFields(
                    csvBuffer,
                    log
                );

                // =====================================================
                // PIVOT HME DATA
                // =====================================================

                const hmeRecords =
                pivotHmeRcdCsv(
                    csvBuffer,
                    log
                );


                // =====================================================
                // UPSERT INTO SUPABASE
                // =====================================================

                log.info(
                `Preparing to upsert ${hmeRecords.length} records into Supabase...`
                );

                await upsertHmeRowsToSupabase(
                hmeRecords,
                log
                );


                // =====================================================
                // 37. OPEN NAMED APIFY KEY-VALUE STORE
                // =====================================================

                const hmeStore =
                    await Actor.openKeyValueStore(
                        'hthsolutions-hme-rcd'
                    );

                log.info(
                    'Opened Key-Value Store: hthsolutions-hme-rcd'
                );


                // =====================================================
                // 38. SAVE CSV
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
                // 39. SAVE RESULT METADATA
                // =====================================================

                await Actor.setValue(
                    'HME_RCD_RESULT',
                    {
                        success:
                            true,

                        store,

                        storeLocation:
                            storeKey,

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
                // 40. PUSH RESULT TO DATASET
                // =====================================================

                await Actor.pushData({
                    success:
                        true,

                    store,

                    storeLocation:
                        storeKey,

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