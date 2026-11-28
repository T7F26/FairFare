# Edit Discount

**Who uses this screen:** Admin
**Where to find it:** FairFare Admin → **Rider Categories** → click a discount in the table

## What this screen is for

Edit Discount lets the admin change a rider category's discount for one transit agency, so an outdated fare rule can be corrected. Every change is saved in the database and recorded in the discount change log.

## How to use it

1. Open the FairFare Admin site and click **Rider Categories** at the top of the page.
2. Find the row for the rider category (for example **Senior**) and the column for the agency (for example **MiWay**).
3. Click the discount in that cell. The **Edit Discount** pop-up opens and shows the category, the agency and the current discount.
4. In **Discount (%)**, type the new discount as a number from 0 to 100 (for example `90` for 90% off the adult fare).
5. Click **Save**.
6. The pop-up closes, a message such as **"Senior updated"** appears above the table, and the new discount is shown in the cell.

To close the pop-up without saving, click **Cancel**.

## Adding a discount where there is none

A dash **(-)** means the agency has no discount for that category. You can click the dash and enter a discount in the same way. Saving adds the new discount for that agency.

## Messages you may see

| Message | What it means | What to do |
|---|---|---|
| **Discount can't be negative** | The number entered is below 0. | Enter a number from 0 to 100. |
| **Please enter a valid discount (%) between 0 and 100.** | The box is empty, is not a number, or is above 100. | Enter a number from 0 to 100. |
| **Could not save the discount. Try again.** | FairFare could not reach the server or the save failed. | Try again after a minute. If it keeps happening, tell the development team. |

## Checking the change history

Each saved change is recorded in the `discount_change_log` table with the agency, the category, the old discount, the new discount and the time of the change. The development team can view it in the database with:

```sql
SELECT * FROM discount_change_log ORDER BY changed_at DESC;
```

## Notes

- Discounts are percentages off the adult fare at that agency. 100% means the category rides free.
- Setting the date a change takes effect is not part of this screen. It will be added with the Set Effective Date story.
