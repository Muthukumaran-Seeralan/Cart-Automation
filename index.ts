import "dotenv/config";
import {
  Action,
  defaultExtractSchema,
  ExtractOptions,
  InferStagehandSchema,
  ObserveOptions,
  pageTextSchema,
  Stagehand,
  StagehandZodSchema,
} from "@browserbasehq/stagehand";
import findChrome from "chrome-finder";
import { BrowserContext, chromium, type Page } from "playwright-core";
import z from "zod";

class BrowserContextManager {
  private static context: BrowserContext | undefined;

  private constructor() {
    throw new Error(
      "Cannot instantiate BrowserContextManager directly. Use methods instead.",
    );
  }

  static async getContext() {
    if (this.context) {
      return this.context;
    }

    const executablePath = findChrome();
    if (!executablePath) {
      throw new Error("Chrome executable not found");
    }

    this.context = await chromium.launchPersistentContext("./user-data", {
      headless: false,
      executablePath,
      args: ["--remote-debugging-port=9222"],
    });

    return this.context;
  }
  static async getCdpUrl() {
    const result = await fetch("http://localhost:9222/json/version");
    const data = (await result.json()) as { webSocketDebuggerUrl: string };
    return data.webSocketDebuggerUrl;
  }
}

class Automation {
  protected HOME_URL = "https://google.com";
  protected page: Page | undefined;
  protected stagehand: Stagehand | undefined;

  protected async getPage() {
    if (this.page) {
      return this.page;
    }
    const context = await BrowserContextManager.getContext();
    const page = await context.newPage();
    await page.goto(this.HOME_URL);
    this.page = page;
    return page;
  }

  private async getStageHand() {
    if (this.stagehand) {
      return this.stagehand;
    }
    await this.getPage();
    const cdpUrl = await BrowserContextManager.getCdpUrl();
    this.stagehand = new Stagehand({
      env: "LOCAL",
      model: {
        modelName: process.env.STAGEHAND_MODEL_NAME!,
        apiKey: process.env.STAGEHAND_MODEL_API_KEY!,
      },
      localBrowserLaunchOptions: {
        cdpUrl,
      },
      verbose: 0,
      logInferenceToFile: true,
    });
    await this.stagehand.init();
    return this.stagehand;
  }

  observe(): Promise<Action[]>;
  observe(options: ObserveOptions): Promise<Action[]>;
  observe(instruction: string, options?: ObserveOptions): Promise<Action[]>;
  async observe(paramOne?: string | ObserveOptions, paramTwo?: ObserveOptions) {
    const stagehand = await this.getStageHand();

    if (!stagehand) {
      throw new Error("Stagehand not initialized");
    }
    stagehand.extract;
    await this.page?.screenshot({ path: "screenshot.png" });

    let finalParamOne: string | ObserveOptions = Object.assign({}, paramOne);
    let finalParamTwo: ObserveOptions | undefined = Object.assign({}, paramTwo);

    if (typeof paramOne === "undefined") {
      const options = paramTwo || {};
      options.page = this.page;
      finalParamOne = options;
    } else if (typeof paramOne === "string") {
      const options = paramTwo || {};
      options.page = this.page;
      finalParamOne = paramOne;
      finalParamTwo = options;
    } else {
      const options = paramOne || {};
      options.page = this.page;
      finalParamOne = options;
    }
    return await stagehand.observe(finalParamOne as any, finalParamTwo);
  }

  extract(): Promise<z.infer<typeof pageTextSchema>>;
  extract(options: ExtractOptions): Promise<z.infer<typeof pageTextSchema>>;
  extract(
    instruction: string,
    options?: ExtractOptions,
  ): Promise<z.infer<typeof defaultExtractSchema>>;
  extract<T extends StagehandZodSchema>(
    instruction: string,
    schema: T,
    options?: ExtractOptions,
  ): Promise<InferStagehandSchema<T>>;
  async extract<T extends StagehandZodSchema>(
    paramOne?: string | ExtractOptions,
    paramTwo?: ExtractOptions | T,
    paramThree?: ExtractOptions,
  ) {
    const stagehand = await this.getStageHand();

    if (!stagehand) {
      throw new Error("Stagehand not initialized");
    }
    let finalInstruction: string | undefined;
    let finalOptions: ExtractOptions = { page: this.page };
    let finalSchema: StagehandZodSchema | undefined;
    if (typeof paramOne === "undefined") {
      // No parameters
    } else if (typeof paramOne === "string") {
      finalInstruction = paramOne;
      if (paramTwo && !(paramTwo instanceof z.ZodType)) {
        finalOptions = { ...finalOptions, ...paramTwo };
      }
      if (paramTwo && paramTwo instanceof z.ZodType) {
        finalSchema = paramTwo;
      }
      if (paramThree) {
        finalOptions = { ...finalOptions, ...paramThree };
      }
    } else {
      finalOptions = { ...finalOptions, ...paramOne };
    }
    return await stagehand.extract(
      finalInstruction || "Extract the text content of the page",
      finalSchema || pageTextSchema,
      finalOptions,
    );
  }
}

class BlinkitAutomation extends Automation {
  protected HOME_URL = "https://blinkit.com";
  private SEARCH_URL = "https://blinkit.com/s/";

  public async addToCart(itemName: string, quantity: number) {
    const page = await this.getPage();
    await page.goto(this.SEARCH_URL);
    await page.pause();

    const actions = await this.observe(
      "Get me  all the inputs, buttons and links",
    );
    const searchInputAction = getMatchingActions(actions, [
      ["search", "input"],
      ["search", "textbox"],
    ])[0];
    await page
      .locator(searchInputAction.selector)
      .pressSequentially(itemName, { delay: 300 });
    await page.pause();
    const items = await this.extract(
      "Extract each item name price and quantity from the search results. Get first 20 items only.",
      z.array(
        z.object({
          name: z.string().describe("Name of the item").min(1),
          price: z.string().describe("Price of the item"),
          qty: z.string().describe("Quantity details of the item"),
        }),
      ),
      {
        selector:
          "xpath=/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div[1]",
      },
    );
    console.log(JSON.stringify(items, null, 2));
  }
}

class ZeptoAutomation extends Automation {
  protected HOME_URL = "https://zepto.com";
}

class InstamartAutomation extends Automation {
  protected HOME_URL = "https://www.swiggy.com/instamart";
}

class MinutesAutomation extends Automation {
  protected HOME_URL =
    "https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL";
}

class Amazon10Automation extends Automation {
  protected HOME_URL = "https://www.amazon.in/";
}

class BigBasketAutomation extends Automation {
  protected HOME_URL = "https://www.bigbasket.com";
}

function getMatchingActions(actions: Action[], keywords: string[][]): Action[] {
  return actions.filter((action) => {
    return keywords.some((keywordCombination) => {
      return keywordCombination.every((keyword) =>
        action.description.toLowerCase().includes(keyword.toLowerCase()),
      );
    });
  });
}

const main = async () => {
  const automation = new BlinkitAutomation();
  await automation.addToCart("icecream", 2);
};

process.on("exit", async () => {
  const context = await BrowserContextManager.getContext();
  await context.close();
});

main();
