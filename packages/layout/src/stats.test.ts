import { parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { layout } from './layout.js';
import { routeStats } from './stats.js';

// Baseline routing-density measurements. The four scenarios cover the
// shapes that motivated the metrics:
//   - snowflake-pinned: hand-pinned 4-col layout from the README's worked
//     example; produces the snowflake `╭│┤` pattern at fact_sales' product_id
//     port.
//   - questionnaire: 12-entity instrument-design schema (the wide
//     `--no-types` diagram in the README); produces the `╮╮` and `├┬╮╮─┤`
//     bend-fusion clusters around questionnaire_question.
//   - star-default: auto-centered fact_sales hub with seven dim subtrees.
//   - blog: 3-table chain (low-density baseline).
const SCENARIOS: Record<string, string> = {
  'snowflake-pinned': `
    Table dim_date     { date_key date [pk] year integer month integer }
    Table dim_country  { country_id integer [pk] name varchar }
    Table dim_region   { region_id integer [pk] name varchar country_id integer [ref: > dim_country.country_id] }
    Table dim_store    { store_id integer [pk] name varchar region_id integer [ref: > dim_region.region_id] }
    Table dim_product  { product_id integer [pk] sku varchar name varchar }
    Table fact_sales {
      sale_id bigint [pk]
      date_key date [ref: > dim_date.date_key]
      store_id integer [ref: > dim_store.store_id]
      product_id integer [ref: > dim_product.product_id]
      quantity integer
      revenue decimal
    }
    @layout {
      pin dim_product at col 2, row 2
    }
  `,
  questionnaire: `
    Table questionnaire { id integer [pk] name varchar }
    Table section { id integer [pk] questionnaire_id integer [ref: > questionnaire.id] name varchar display_order integer }
    Table questionnaire_question {
      qq_id integer [pk]
      questionnaire_id integer [ref: > questionnaire.id]
      question_id integer [ref: > question.question_id]
      section_id integer [ref: > section.id]
      parent_qq_id integer
      count_qq_id integer
      display_order integer
      required boolean
    }
    Table question { question_id integer [pk] link_id varchar question_type varchar question_text varchar concept_id integer version varchar }
    Table response_option_set { option_set_id integer [pk] name varchar canonical_url varchar }
    Table response_option { option_id integer [pk] question_id integer [ref: > question.question_id] option_set_id integer [ref: > response_option_set.option_set_id] option_text varchar option_value varchar concept_id integer }
    Table grid_column { column_id integer [pk] question_id integer [ref: > question.question_id] column_text varchar column_value varchar }
    Table grid_row { row_id integer [pk] question_id integer [ref: > question.question_id] row_text varchar display_order integer }
    Table skip_rule { skip_rule_id integer [pk] qq_id integer [ref: > questionnaire_question.qq_id] trigger_qq_id integer operator varchar trigger_value varchar action varchar enable_behavior varchar }
    Table scoring_rule { scoring_rule_id integer [pk] questionnaire_id integer [ref: > questionnaire.id] name varchar formula varchar }
    Table scoring_rule_item { scoring_rule_id integer [ref: > scoring_rule.scoring_rule_id] qq_id integer [ref: > questionnaire_question.qq_id] weight real reverse_score boolean }
    Table scoring_category { category_id integer [pk] scoring_rule_id integer [ref: > scoring_rule.scoring_rule_id] label varchar min_score real max_score real }
  `,
  'star-default': `
    Table dim_date     { id int [pk] date date }
    Table dim_customer { id int [pk] email varchar }
    Table dim_product  { id int [pk] sku varchar }
    Table dim_store    { id int [pk] name varchar }
    Table channel_dim  { id int [pk] name varchar }
    Table currency_dim { id int [pk] code varchar }
    Table employee_dim { id int [pk] name varchar }
    Table sales_fact {
      id int [pk]
      date_id int [ref: > dim_date.id]
      product_id int [ref: > dim_product.id]
      store_id int [ref: > dim_store.id]
      customer_id int [ref: > dim_customer.id]
      promotion_id int
      channel_id int [ref: > channel_dim.id]
      currency_id int [ref: > currency_dim.id]
      employee_id int [ref: > employee_dim.id]
      quantity int
      unit_price int
      total int
    }
  `,
  blog: `
    Table users { id int [pk] email varchar }
    Table posts { id int [pk] user_id int [ref: > users.id] title varchar }
    Table comments { id int [pk] post_id int [ref: > posts.id] user_id int [ref: > users.id] body varchar }
  `,
};

describe('route stats baseline', () => {
  for (const [name, dbml] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const stats = routeStats(layout(parse(dbml)));
      expect(stats).toMatchSnapshot();
    });
  }
});
