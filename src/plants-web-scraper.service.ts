import puppeteer, { Browser, HTTPResponse } from 'puppeteer';
import { catchError, defer, forkJoin, from, mergeMap, Observable, of, shareReplay, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { GovPlantsDataService } from './PLANTS_data.service';
import fs from 'fs';
import path from 'path';

export class PlantsWebScraperService {
  public readonly usdaGovPlantProfileUrl: string = 'https://plants.usda.gov/plant-profile/';

  private readonly _CONCURRENT_REQUESTS: number = 5;
  private readonly _DOWNLOAD_TIMEOUT_TIME: number = 1 * 60 * 1000;
  private readonly _DISTRIBUTION_DATA_HEADER: string = 'DistributionData';
  private readonly _TEMP_DOWNLOAD_PATH: string = 'downloads/';

  private readonly _CSVName: string = 'PLANTS_EXTRA_DATA.csv';
  private readonly _CSVHeaders: string[] = ['Accepted Symbol', 'Counties', 'Common Name'];
  private readonly _PlantProfileHeaderName: string = 'plant-profile-header';
  private readonly _csvPath = './assets/' + this._CSVName;
  private readonly _ngDestroy$: Subject<void> = new Subject<void>();
  private readonly _csvWriter$: Subject<string> = new Subject<string>();
  private readonly _browserRequest$: Observable<Browser> = from(puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })).pipe(
    shareReplay(1),
    takeUntil(this._ngDestroy$));


  constructor(private readonly _plantDataService: GovPlantsDataService) {
    this._csvWriter$.pipe(
      tap((value) => {
        console.log('Writing Value ' + value);
        fs.appendFileSync(this._csvPath, value);
        fs.appendFileSync(this._csvPath, "\r\n");
      }))
      .subscribe();
  }

  public write(): Observable<any> {
    const escapedHeaders = this._CSVHeaders.map((x: string) => '"' + x + '"').join(',') + '\r\n';
    const allIdsCSVPath = './assets/allIds.csv';

    return this._plantDataService.getAllNativePlantIds().pipe(
      switchMap((ids: ReadonlyArray<string>) => {
        // If file does not exist, create the file with headers
        if (fs.existsSync(this._csvPath))
          fs.unlinkSync(this._csvPath);
        fs.writeFileSync(this._csvPath, escapedHeaders);

        if (fs.existsSync(allIdsCSVPath))
          fs.unlinkSync(allIdsCSVPath);
        fs.writeFileSync(allIdsCSVPath, ids.join(','));

        return forkJoin([of(ids), this._browserRequest$]);
      }),
      switchMap(([ids, browser]: [ReadonlyArray<string>, Browser]) =>
        from(ids).pipe(mergeMap((id) => this.writeSpeciesRxjs(browser, id), this._CONCURRENT_REQUESTS))),
      catchError((err: any) => {
        console.error(err);
        return of();
      }),
      takeUntil(this._ngDestroy$)
    );
  }

  private async writeSpecies(browser: Browser, id: string) {
    const page = await browser.newPage();
    await page.goto(`${this.usdaGovPlantProfileUrl}${id}`);
    let download: Promise<void> = new Promise((_, reject) => setTimeout(() => reject, this._DOWNLOAD_TIMEOUT_TIME));

    page.setRequestInterception(true);
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'deny', // Prevent automatic downloads
    });

    page.on('request', (request) => {
      request.continue();
    });

    page.on(('response'), async (response: HTTPResponse) => {
      if (PlantsWebScraperService.isValidCSV(response)) {
        const csvData = await response.text();
        const filename = `${id}.${this._DISTRIBUTION_DATA_HEADER}.csv`;
        const filepath = path.resolve(this._TEMP_DOWNLOAD_PATH, filename);
        fs.writeFileSync(filepath, csvData);
        download = Promise.resolve()
      }
    });

    const downloadLinkClass = '.download-distribution-link';
    const linkElement = await page.waitForSelector(downloadLinkClass);
    await linkElement?.click();

    const downloadButton = await page.waitForSelector('a[download]');
    if (downloadButton) {
      const newTabUrl: string | null = await page.evaluate((downloadButton: HTMLAnchorElement) => downloadButton.href, downloadButton);
      console.log(newTabUrl);
      if (newTabUrl) {
        await downloadButton.click();
      }
      else {
        download = Promise.reject('invalid download');
      }
    }

    const parentElement = await page.waitForSelector(this._PlantProfileHeaderName);
    if (parentElement) {
      const commonName = await page.evaluate((parentEl: Element) => {
        const childrenElements = parentEl.children;

        for (let i = 1; i < childrenElements.length; i++) {
          const childElement = childrenElements.item(i);

          if (childElement &&
            childElement.tagName === 'H2' &&
            childElement.textContent?.trim()) {
            return childElement.textContent.trim().replace(/"/g, '""');
          }
        }

        return "";
      }, parentElement);

      await download;
      const csvRow: string = `"${id}","${null}","${commonName}"`;
      this._csvWriter$.next(csvRow);
      console.log(csvRow);
    }

    await page.close();

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
    this._ngDestroy$.next();
    this._ngDestroy$.complete();
  }
}
