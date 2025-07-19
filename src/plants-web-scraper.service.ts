import puppeteer, { Browser, HTTPResponse } from 'puppeteer';
import { catchError, defer, forkJoin, from, last, mergeMap, Observable, of, retry, shareReplay, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { GovPlantsDataService } from './PLANTS_data.service';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { County, ExtraInfo } from '../models/gov/models';

export class PlantsWebScraperService {
  public readonly usdaGovPlantProfileUrl: string = 'https://plants.usda.gov/plant-profile/';

  private readonly _CONCURRENT_REQUESTS: number = 5;
  private readonly _DOWNLOAD_TIMEOUT_TIME: number = 5 * 60 * 1000; // 10 min
  private readonly _DISTRIBUTION_DATA_HEADER: string = 'Distribution Data';
  private readonly _TEMP_DOWNLOAD_PATH: string = 'downloads/';
  private readonly _PlantProfileHeaderName: string = 'plant-profile-header';
  private readonly _RETRIES: number = 3;

  private readonly _jsonExtension: string = '.json';
  private readonly _CSVExtension: string = '.csv';
  private readonly _jsonName: string = 'PLANTS_EXTRA_DATA' + this._jsonExtension;
  private readonly _jsonPath = './assets/' + this._jsonName;
  private readonly _ngDestroy$: Subject<void> = new Subject<void>();
  private readonly _jsonWriter$: Subject<string> = new Subject<string>();
  private _jsonStarted: boolean = false;
  private readonly _browserRequest$: Observable<Browser> = from(puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })).pipe(
    shareReplay(1),
    takeUntil(this._ngDestroy$));

  constructor(private readonly _plantDataService: GovPlantsDataService) {
    if (fs.existsSync(this._jsonPath)) {
      fs.unlinkSync(this._jsonPath);
    }

    fs.writeFileSync(this._jsonPath, '[\r\n');
    this._jsonStarted = true;
    this._jsonWriter$.pipe(
      // TODO could just accept everything, store in mem, write to csv at the end but it would be so much so i dont think we can
      tap((value) => {
        // console.log('Writing Value ' + value);
        fs.appendFileSync(this._jsonPath, value);

        if (this._jsonStarted) {
          fs.appendFileSync(this._jsonPath, ',');
        }

        fs.appendFileSync(this._jsonPath, "\r\n");
      }),
    )
      .subscribe();
  }

  public write(): Observable<any> {
    const allIdsCSVPath = './assets/allIds' + this._CSVExtension;

    return this._plantDataService.getAllNativePlantIds().pipe(
      switchMap((ids: ReadonlyArray<string>) => {
        if (fs.existsSync(allIdsCSVPath))
          fs.unlinkSync(allIdsCSVPath);
        fs.writeFileSync(allIdsCSVPath, ids.join(','));

        return forkJoin([of(ids), this._browserRequest$]);
      }),
      switchMap(([ids, browser]: [ReadonlyArray<string>, Browser]) =>
        from(ids).pipe(mergeMap((id) => this.writeSpeciesRxjs(browser, id).pipe(retry(this._RETRIES)), this._CONCURRENT_REQUESTS))),
      catchError((err: any) => {
        console.error(err);
        return of();
      }),
      takeUntil(this._ngDestroy$)
    );
  }

  private async writeSpecies(browser: Browser, id: string) {
    // try new browser context so its easier to target specific downloads ??
    const browserContext = await browser.createBrowserContext();
    const page = await browserContext.newPage();
    await page.goto(`${this.usdaGovPlantProfileUrl}${id}`).catch((err) => {
      console.error(err);
      return;
    });

    let download: Promise<void> = new Promise((_, reject) => setTimeout(() => reject(id), this._DOWNLOAD_TIMEOUT_TIME));
    download.catch((err) => {
      console.error(err, id);
      return;
    })
    let commonName: string = '';

    await page.setRequestInterception(true);
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'deny', // Prevent automatic downloads
    });

    page.on('request', (request) => {
      request.continue();
    });

    page.on(('response'), async (response: HTTPResponse) => {
      if (PlantsWebScraperService.isValidCSV(response)) {
        let csvData = await response.text();
        const filename = id + this._CSVExtension;
        const filepath = path.resolve(this._TEMP_DOWNLOAD_PATH, filename);
        csvData = csvData.substring(this._DISTRIBUTION_DATA_HEADER.length + 2);
        fs.writeFileSync(filepath, csvData);
        download = Promise.resolve()
      }
    });

    // TODO Might not have one if the link is broken
    const downloadLinkClass = '.download-distribution-link';
    const linkElement = await page.waitForSelector(downloadLinkClass).catch((err) => {
      console.error(err, id);
      download = this.invalidDownload(download, id);
    });

    if (linkElement)
      await linkElement?.click();

    const downloadButton = await page.waitForSelector('a[download]')
      .catch((err) => {
        console.error(err, id);
        download = this.invalidDownload(download, id);
      });

    if (downloadButton && !(await page.evaluate((downloadButton: HTMLAnchorElement) => downloadButton.href, downloadButton)).endsWith('undefined'))
      await downloadButton.click().catch((err) => console.error(err, id));
    else
      download = this.invalidDownload(download, id);

    const parentElement = await page.waitForSelector(this._PlantProfileHeaderName).catch((err) => console.error(err, id));
    if (parentElement) {
      commonName = await page.evaluate((parentEl: Element) => {
        const childrenElements = parentEl.children;

        for (let i = 1; i < childrenElements.length; i++) {
          const childElement = childrenElements.item(i);

          if (childElement &&
            childElement.tagName === 'H2' &&
            childElement.textContent?.trim() &&
            childElement.textContent.trim() !== 'Subheader') {
            return childElement.textContent.trim().replace(/"/g, '""');
          }
        }

        return '';
      }, parentElement).catch((err) => {
        console.error(err, id);
        return '';
      });
    }

    // TODO figure out why we cant skip writing on failed download
    await download.catch((reason: any) => {
      console.log('Skipping csv writing for ' + id, reason);
      return;
    });

    const data: string[] = await PlantsWebScraperService.pullDataAndDeleteCSV(path.resolve(this._TEMP_DOWNLOAD_PATH, id + this._CSVExtension)).catch((err) => {
      console.error(err, id);
      return [];
    });

    await page.close().catch((err) => console.error(err, id));
    await browserContext.close().catch((err) => console.error(err, id));

    // Skip when csv not found
    if (data.length == 0)
      return;

    const counties: County[] = [];
    for (let i = 1; i < data.length; i++) {
      const values: string[] = data[i].split(',');
      // Skip the empty county rows
      if (values[4]?.length == 0)
        continue;

      const stateFip: number = Number.parseInt(values[3]);
      // Dictionary of state abbrev to county info

      counties.push({
        stateFIP: stateFip,
        name: values[4],
        FIP: Number.parseInt(values[5])
      });
    }

    const extraInfo: ExtraInfo = {
      symbol: id,
      commonName: commonName,
      counties: counties,
    };

    const json: string = JSON.stringify(extraInfo);
    this._jsonWriter$.next(json);
  }

  private invalidDownload(download: Promise<void>, id: string) {
    download = Promise.resolve();
    console.log('invalid file download for ', id);
    return download;
  }

  private static async pullDataAndDeleteCSV(path: string): Promise<string[]> {
    const lines: string[] = [];
    if (!fs.existsSync(path))
      return lines;
    const fileStream = fs.createReadStream(path);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    // Note: we use the crlfDelay option to recognize all instances of CR LF

    // Each line in file will be successively available here as `line`.
    for await (const line of rl) {
      lines.push(line);
    }
    fileStream.close();
    fs.unlinkSync(path);

    return lines;
  }

  private static isValidCSV(response: HTTPResponse): boolean {
    return response.url().includes('csv') ||
      response.url().includes('DistributionData') ||
      response.headers()['content-type']?.includes('text/csv');
  }

  private writeSpeciesRxjs(browser: Browser, id: string): Observable<void> {
    return defer(() => (this.writeSpecies(browser, id)));
  }

  public destroy(): void {
    this._jsonStarted = false;
    this._jsonWriter$.next(']');

    this._jsonWriter$.pipe(
      last()
    ).subscribe({
      next: () => {
        this._ngDestroy$.next();
        this._ngDestroy$.complete();
      }
    });
  }
}
