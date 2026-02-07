import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import findChrome from "chrome-finder";
import {
  BrowserContext,
  chromium,
  selectors,
  type Page,
} from "playwright-core";
import { z } from "zod";

class BrowserContextManager {
  private static context: BrowserContext | undefined;

  private constructor() {
    throw new Error(
      "Cannot instantiate BrowserContextManager directly. Use static methods instead.",
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
    const context = await fetch("http://localhost:9222/json/version");
    const data = (await context.json()) as { webSocketDebuggerUrl: string };
    return data.webSocketDebuggerUrl;
  }
}

class Automation {
  protected static HOME_URL = "https://google.com";
  protected static page: Page | undefined;
  protected static stagehand: Stagehand | undefined;
  static async getPage() {
    if (this.page) {
      return this.page;
    }
    const context = await BrowserContextManager.getContext();
    const page = await context.newPage();
    await page.goto(this.HOME_URL);
    this.page = page;
    return page;
  }
  static async getStageHand() {
    if (this.stagehand) {
      return this.stagehand;
    }
    // TODO: reuse stagehand instances across automations
    await this.getPage();
    console.log(process.env.STAGEHAND_MODEL_NAME);
    console.log(process.env.STAGEHAND_MODEL_API_KEY);
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
}

class BlinkitAutomation extends Automation {
  protected static HOME_URL = "https://blinkit.com";
}

class ZeptoAutomation extends Automation {
  protected static HOME_URL = "https://zepto.com";
}

class InstamartAutomation extends Automation {
  protected static HOME_URL = "https://www.swiggy.com/instamart";
}

class MinutesAutomation extends Automation {
  protected static HOME_URL =
    "https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL";
}

class Amazon10Automation extends Automation {
  protected static HOME_URL = "https://www.amazon.in/";
}

class BigBasketAutomation extends Automation {
  protected static HOME_URL = "https://www.bigbasket.com";
}

const main = async () => {
  const stagehand = await ZeptoAutomation.getStageHand();
  const zeptoPage = await ZeptoAutomation.getPage();

  await zeptoPage.pause();

  // Navigate to Cart using provided XPath
  console.log("Opening Cart...");
  await zeptoPage
    .locator("xpath=/html/body/div[2]/div/div/div/div/div/header/div/div[4]")
    .click();
  await zeptoPage.waitForTimeout(2000);

  // Empty Cart Loop
  console.log("Checking for items to remove...");
  for (let i = 0; i < 10; i++) {
    const actions = await stagehand.observe(
      "find the 'remove' button to delete items from the cart",
    );
    const removeAction = actions.find((action) =>
      action.description.toLowerCase().includes("remove"),
    );

    if (removeAction) {
      console.log("Removing item:", removeAction.description);
      const locator = zeptoPage.locator(removeAction.selector).first();
      if (await locator.isVisible()) {
        await locator.click();
        // specific wait for Zepto UI update
        await zeptoPage.waitForTimeout(1500);
      } else {
        break;
      }
    } else {
      console.log("No remove buttons found. Cart is likely empty.");
      break;
    }
  }

  const actions = await stagehand.observe(` find the search bar .`);
  console.log("Observed Actions:", actions);
  const searchInputAction = actions.find((action) => {
    const keywords = [
      ["search", "textbox"],
      ["search", "input"],
      ["search", "product"],
    ];
    const description = action.description.toLowerCase();
    return keywords.some((combination) =>
      combination.every((keyword) => description.includes(keyword)),
    );
  });
  console.log("Search Input Action:", searchInputAction);
  await zeptoPage.pause();
  const searchLocator = zeptoPage.locator(searchInputAction!.selector);
  await searchLocator.click();

  // Wait for the actual input field to be visible after clicking the trigger
  // Zepto often uses an <a> tag as a wrapper/trigger, so we need to find the real input
  const inputLocator = zeptoPage.locator(
    'input[placeholder*="Search"], input[type="text"]',
  );
  await inputLocator.first().waitFor({ state: "visible", timeout: 5000 });

  await inputLocator.first().pressSequentially("milk", { delay: 100 });
  await zeptoPage.waitForTimeout(1000);
  //hit enter to search
  await inputLocator.first().press("Enter");
  //delay for search results to load
  await zeptoPage.waitForTimeout(5000);
  // extract cheapest product name and price from the results using stagehand act
  const extractActions = await stagehand.extract(
    "Extract each item name price and quantity from the search results. Get first 15 items only.",
    z.array(
      z.object({
        name: z.string().describe("Name of the item").min(1),
        price: z.string().describe("Price of the item"),
        qty: z.string().describe("Quantity details of the item"),
      }),
    ),

    {
      selector:
        "xpath=/html/body/div[2]/div[1]/div[2]/div/div/div[2]/div/div/div/div/div/div/div/div",
    },
  );
  console.log(JSON.stringify(extractActions, null, 2));
  // now let me select from the extracted items
  const randomIndex = Math.floor(Math.random() * extractActions.length);
  const itemSelectAction = extractActions[randomIndex];
  console.log("Selecting item:", itemSelectAction);
  await zeptoPage.pause();
  console.log("Adding item to cart:", itemSelectAction.name);

  // Locate the specific product card by text and click the "Add" button inside it
  await zeptoPage
    .locator("div")
    .filter({ hasText: itemSelectAction.name })
    .getByRole("button", { name: "add" })
    .first()
    .click();

  await zeptoPage.waitForTimeout(2000);
  await zeptoPage.pause();
  await zeptoPage.waitForTimeout(500);
  // press enter
  await zeptoPage.keyboard.press("Enter");
  await zeptoPage.waitForTimeout(2000);

  console.log("Verifying item added and finding Cart button...");
  const cartActions = await stagehand.observe(
    "Find the cart button/banner. It should be focusable, contain text 'Cart' and '1' indicating an item is added.",
  );

  console.log("Cart Observations:", cartActions);

  // Find the action that matches the user's description best
  const cartAction =
    cartActions.find((action) => {
      const desc = action.description.toLowerCase();
      // Look for Cart AND 1, or just Cart if strict match fails, but prioritize the one with '1'
      return desc.includes("cart") && desc.includes("1");
    }) ||
    cartActions.find((action) =>
      action.description.toLowerCase().includes("cart"),
    );

  if (cartAction) {
    console.log("Clicking Cart/Banner:", cartAction);
    await zeptoPage.locator(cartAction.selector).click();
    console.log("Clicked Cart button.");
  } else {
    console.error("Cart button not found!");
  }

  await zeptoPage.waitForTimeout(3000);
  await zeptoPage.pause();

  await stagehand.close();
  await closeContext();
};

const closeContext = async () => {
  const context = await BrowserContextManager.getContext();
  await context.close();
};

process.on("exit", async () => {
  closeContext();
});

main();
