import puppeteer, { Browser, Page } from 'puppeteer';
import { catchError, defer, first, forkJoin, from, interval, mergeMap, Observable, of, shareReplay, Subject, switchMap, takeUntil, tap, zip } from 'rxjs';
import { GovPlantsDataService } from './PLANTS_data.service';
import fs from 'fs';

export class PlantsWebScraperService {
  public readonly usdaGovPlantProfileUrl: string = 'https://plants.usda.gov/plant-profile/';

  private readonly _CONCURRENT_REQUESTS: number = 5;
  private reaodnly _DOWNLOAD_TIMEOUT_TIME: number : 1 * 60 * 1000;

  private readonly _CSVName: string = 'PLANTS_EXTRA_DATA.csv';
  private readonly _CSVHeaders: string[] = ['Accepted Symbol', 'Counties', 'Common Name'];
  private readonly _PlantProfileHeaderName: string = 'plant-profile-header';
  private readonly _csvPath = './assets/' + this._CSVName;
  private readonly _ngDestroy$: Subject<void> = new Subject<void>();
  private readonly _csvWriter$: Subject<string> = new Subject<string>();
  private readonly _browserRequest$: Observable<Browser> = from(puppeteer.launch({
    headless: false,
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
    page.setRequestInterception(true);
    const client = await page.


    const downloadLinkClass = '.download-distribution-link';
    const linkElement = await page.waitForSelector(downloadLinkClass);
    await linkElement?.click();

    const downloadButton = await page.waitForSelector('a[download]');
    if (downloadButton) {
      const newTabUrl: string | null = await page.evaluate((downloadButton: Element) => downloadButton.getAttribute('href'), downloadButton);
      await downloadButton.click();



      console.log(json);
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

            const escapedText = childElement.textContent.trim().replace(/"/g, '""');
            return escapedText;
          }
        }

        return "";
      }, parentElement);

      const csvRow: string = `"${id}","${null}","${commonName}"`;
      this._csvWriter$.next(csvRow);
      console.log(csvRow);
    }

    await page.close();
  }

  private writeSpeciesRxjs(browser: Browser, id: string): Observable<void> {
    return defer(() => (this.writeSpecies(browser, id)));
  }

  public destroy(): void {
    this._ngDestroy$.next();
    this._ngDestroy$.complete();
  }
}
