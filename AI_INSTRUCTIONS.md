# LANDIQ — FINAL MASTER DEVELOPMENT PROMPT

## Complete Commercial E-commerce Landing Page Management Software

**PROJECT NAME:** LANDIQ
**PRODUCT TYPE:** Commercial E-commerce Landing Page Management Software
**DEVELOPMENT MODE:** Build and implement the actual working software
**ARCHITECTURE:** Single-Tenant Modular Monolith
**BUSINESS MODEL:** Direct Software Sales — One-Time Software Purchase / Independent Installation

---

# 1. YOUR ROLE

Act as a Senior Software Architect, Senior Full-Stack Engineer, Database Architect, UI/UX Engineer, DevSecOps Engineer, and QA Engineer.

Your responsibility is to build LANDIQ as a professional, secure, scalable, production-oriented commercial software product.

Do not merely generate a prototype, documentation, or UI mockup. Build the actual functional application, including frontend, backend, database, integrations, security, testing, and deployment configuration.

Use professional engineering practices and make technically sound decisions independently.

# 2. CRITICAL EXECUTION RULES

These rules are mandatory.

1. One prompt = One project = One implementation.
2. Build only LANDIQ. Do not create alternative projects.
3. Never create Option A, Option B, or parallel implementations.
4. Do not repeatedly ask for confirmation about ordinary technical decisions.
5. Do not spend excessive time planning or researching.
6. Inspect the existing repository, identify its current architecture, and prepare a concise implementation plan.
7. Start implementation immediately after repository inspection.
8. Reuse working code where appropriate. Do not unnecessarily rewrite the existing application.
9. Do not replace existing functionality without understanding its dependencies.
10. Avoid unnecessary dependencies, abstractions, microservices, and overengineering.
11. Prioritize working features over lengthy documentation.
12. Do not create placeholder buttons or fake functionality.
13. Do not simulate successful API responses.
14. Never claim that a feature or test is complete unless it has actually been implemented and verified.
15. Maintain a concise progress report after completing each major development phase.
16. If interrupted by context or execution limits, save progress and document:
    - Completed work
    - Current implementation status
    - Remaining tasks
    - Known issues
    - Exact next implementation step
17. Resume from the unfinished phase using the same repository and architecture.
18. Do not restart the project or repeat completed work unnecessarily.

**Execution priority:** Inspect → Implement → Test → Fix → Document.

# 3. PRODUCT DEFINITION

LANDIQ is a commercial e-commerce landing page management software.

It is NOT a SaaS platform.

The software will be sold directly to business owners. Each customer receives an independent installation for their own business.

Each installation belongs to one business.

Example:

A business owner installs LANDIQ on:

`https://example.com`

From one centralized dashboard, the owner can manage multiple products and create independent landing pages.

Example public URLs:

- `example.com/p/premium-tshirt`
- `example.com/p/wireless-earbuds`
- `example.com/p/smart-watch`

Each product can have its own landing page, content, design, SEO settings, images, pricing, variants, and order form.

All pages are managed through one dashboard.

## Explicitly Excluded

Do NOT build:

- SaaS subscription management
- SaaS monthly or yearly billing
- Free/Paid subscription plans
- Multi-tenant architecture
- Workspace-based SaaS accounts
- SaaS platform administration
- Artificial product or landing page limits
- Mandatory paid payment gateway requirements
- Mandatory courier integration requirements

Do not restrict the number of products or landing pages artificially. Actual capacity depends on the buyer's hosting, database, and storage resources.

# 4. TECHNICAL STACK

Use the following stack unless the existing repository has a strong technical reason to retain an equivalent implementation.

- Next.js App Router
- React
- TypeScript with strict mode
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- PostgreSQL
- Prisma ORM
- Zod
- Secure authentication solution
- S3-compatible object storage
- Redis and BullMQ only where genuinely necessary
- Vitest
- React Testing Library
- Playwright
- Docker
- Nginx or an appropriate production reverse proxy

Use current stable, mutually compatible package versions.

Do not upgrade major dependencies blindly. Inspect the current repository and verify compatibility before changing versions.

# 5. ARCHITECTURE

Use a Single-Tenant Modular Monolith with a clean layered architecture.

Recommended structure:

- Presentation Layer
- Application / Service Layer
- Business Logic Layer
- Data Access Layer
- Database Layer
- Integration Layer

Use:

- Server Components where appropriate
- Server Actions where appropriate
- Route Handlers for APIs and external callbacks
- Centralized validation
- Server-side authorization
- Reusable service modules
- Clear module boundaries

Avoid microservices, Kubernetes, unnecessary queues, and unnecessary infrastructure.

# 6. AUTHENTICATION AND ACCESS CONTROL

Implement:

- Secure login and logout
- Password hashing
- Secure session management
- Password reset
- Session revocation
- Login history
- Staff management
- Role-Based Access Control (RBAC)
- Permission management

Default roles:

- Owner
- Administrator
- Manager
- Product Manager
- Order Manager
- Marketing Manager
- Viewer

The Owner must have complete control.

Permissions must be enforced on the server, not only hidden in the frontend.

There must be no public SaaS registration or workspace creation.

# 7. BUSINESS SETTINGS

Create a centralized business settings module.

Include:

- Business name
- Logo
- Description
- Business email
- Phone number
- Address
- Social media links
- Currency
- Time zone
- Branding
- Delivery information
- Return policy
- Privacy policy
- Terms and conditions

Support global branding with optional individual landing page overrides.

# 8. PRODUCT MANAGEMENT

Implement complete product management.

Features:

- Create, edit, delete, duplicate, archive
- Publish and unpublish
- Categories
- SKU
- Regular price
- Sale price
- Product descriptions
- Images and videos
- Specifications
- Weight and dimensions
- Stock management
- Custom attributes
- Product variants

Support flexible product attributes.

Examples:

Fashion:

- Size
- Color
- Fabric

Electronics:

- RAM
- Storage
- Processor
- Color

Other products:

- Brand
- Model
- Material
- Custom specifications

Each variant may have its own:

- Price
- SKU
- Stock
- Image
- Attributes

Do not hardcode attributes for individual product categories.

# 9. INVENTORY MANAGEMENT

Implement:

- Stock quantity
- Stock movement history
- Low-stock alerts
- Stock reservations
- Order-based stock deduction
- Cancellation-based stock restoration
- Return-based stock adjustment
- Inventory transaction history
- Overselling protection

Use database transactions and concurrency-safe stock updates.

# 10. MULTI-PRODUCT LANDING PAGE ENGINE

Build one reusable landing page renderer.

Do not hardcode a separate page implementation for every product.

Each product landing page must support:

- Independent slug
- Independent content
- Independent design
- Independent images
- Independent pricing
- Independent SEO
- Independent CTA
- Independent analytics
- Draft and published status
- Scheduled publishing where supported

Public route:

`/p/[product-slug]`

# 11. VISUAL LANDING PAGE BUILDER

Create a visual, section-based landing page builder.

The business owner must be able to:

- Add sections
- Edit sections
- Delete sections
- Duplicate sections
- Reorder sections
- Enable/disable sections
- Change text and images
- Change colors
- Change typography
- Change backgrounds
- Customize spacing
- Customize buttons
- Preview changes
- Save drafts
- Publish changes

Support desktop, tablet, and mobile previews.

Initial section library:

1. Announcement Bar
2. Header
3. Hero Section
4. Problem and Solution
5. Benefits
6. Features
7. Product Gallery
8. Product Video
9. Specifications
10. Variants
11. Pricing
12. Offers
13. Comparison
14. Testimonials
15. Reviews
16. FAQ
17. Delivery Information
18. Trust Section
19. CTA
20. Order Form
21. Related Products
22. Footer

Use validated structured content.

Never allow arbitrary user-submitted JavaScript execution.

Sanitize user-controlled content.

# 12. LANDING PAGE TEMPLATES

Provide reusable templates for:

- Fashion
- Electronics
- Beauty
- Home and Lifestyle
- Gadgets
- General Products

Templates must be editable after selection.

Use professional, conversion-focused, responsive designs.

# 13. PUBLIC LANDING PAGE EXPERIENCE

Build premium customer-facing landing pages.

Requirements:

- Mobile-first responsive design
- Fast loading
- Optimized images
- Product gallery
- Image zoom
- Variant selector
- Quantity selector
- Sticky purchase button
- Buy Now
- WhatsApp contact option
- Social sharing
- Coupon support
- Delivery information
- Related products
- Clear pricing
- Trust information
- Accessible UI

Do not generate fake reviews, fake scarcity, fake countdowns, or misleading discounts.

# 14. SEO

Implement built-in SEO for every landing page.

Include:

- Dynamic title and description
- Canonical URL
- Open Graph metadata
- Twitter cards
- XML sitemap
- Robots.txt
- Product structured data
- Organization structured data
- Breadcrumb structured data
- Semantic HTML
- Image alt text
- Clean URLs
- Noindex controls
- Redirect management
- Duplicate content prevention
- Image optimization
- Mobile-friendly output

Structured data must represent actual visible information.

Draft and unpublished pages must not be indexed.

Never promise search engine ranking.

# 15. ORDER MANAGEMENT

Implement complete order management.

Customer order information:

- Name
- Phone
- Optional email
- Address
- District
- Area
- Product
- Variant
- Quantity
- Delivery option
- Customer note

Support configurable required and optional fields.

Features:

- Unique order number
- Duplicate submission protection
- Order status
- Order search
- Filtering
- Pagination
- Export
- Print
- Invoice generation
- Order history

Use transaction-safe order creation and inventory operations.

# 16. PAYMENT SYSTEM — DASHBOARD-CONTROLLED PROVIDERS

This is a critical requirement.

LANDIQ must support multiple payment methods, but NO payment gateway should be mandatory.

The business owner must have complete control over which payment methods are available to customers.

## Supported payment methods

1. Cash on Delivery (COD)
2. SSLCommerz
3. bKash
4. Nagad

Prepare the architecture so additional providers can be added later.

## A. Individual Enable/Disable Controls

Inside the Dashboard, create:

`Settings → Payments → Payment Methods`

Display each provider separately.

Example:

| Payment Method   | Enabled | Customer Checkout Visibility |
| ---------------- | ------- | ---------------------------- |
| Cash on Delivery | ON/OFF  | ON/OFF                       |
| SSLCommerz       | ON/OFF  | ON/OFF                       |
| bKash            | ON/OFF  | ON/OFF                       |
| Nagad            | ON/OFF  | ON/OFF                       |

The Owner must be able to:

- Enable a payment method
- Disable a payment method
- Show or hide a payment method at checkout
- Configure its credentials
- Test its connection
- Select a default payment method
- View integration status
- View transaction history

Do not force the business owner to activate every payment method.

## B. COD Must Work Independently

COD must be available without any payment gateway credentials.

A business owner must be able to operate LANDIQ using only Cash on Delivery.

If SSLCommerz, bKash, and Nagad are disabled, the customer checkout must show only COD.

If the owner enables bKash but disables the other gateways, only COD and bKash should be visible.

If all payment gateways are disabled and COD is enabled, order placement must still work normally.

Never make paid gateway integration a requirement for basic order processing.

## C. Payment Visibility Rules

Implement the following logic:

- Disabled provider → Never show it at customer checkout.
- Enabled provider with valid configuration → Eligible to show at checkout.
- Enabled provider with missing or invalid credentials → Show an appropriate dashboard warning and prevent unusable checkout selection.
- Hidden provider → Do not show it publicly even if technically configured.
- COD enabled → Allow COD orders without external payment API calls.
- COD disabled → Do not offer COD at checkout.

The backend must validate the selected payment method again when creating an order.

Never trust frontend visibility settings alone.

## D. Payment Provider Configuration

For each provider, provide:

- Enable/disable switch
- Checkout visibility switch
- Sandbox/test mode where supported
- Production mode
- API credentials
- Connection test
- Integration status
- Error logs
- Transaction history

Never expose secret credentials in frontend code or API responses.

## E. Real Payment API Integration

Implement real integrations following official documentation.

SSLCommerz:

- Payment initialization
- Redirect/checkout
- IPN and callback verification
- Transaction validation
- Success, failure, and cancellation handling
- Refund support where officially available

bKash:

- Tokenized Checkout
- Create Payment
- Execute Payment
- Query Payment
- Callback handling
- Refund support where officially available

Nagad:

- Payment initialization
- Official authentication and signature/encryption verification
- Callback validation
- Payment status verification
- Refund support where officially available

Requirements:

- Verify payment server-side.
- Never trust frontend success redirects.
- Implement idempotency.
- Prevent duplicate payment processing.
- Store transaction references.
- Maintain payment logs.
- Handle provider failures safely.
- Never store card details.
- Use official API documentation.

If credentials or merchant approval are unavailable, implement the verified integration structure and clearly mark it as awaiting credentials. Never pretend it is live.

# 17. COURIER SYSTEM — DASHBOARD-CONTROLLED PROVIDERS

Courier integrations must also be optional.

Supported providers:

1. Pathao Courier
2. Steadfast Courier
3. REDX

Create:

`Settings → Shipping & Courier`

## A. Individual Courier Controls

Provide separate controls for:

- Enable/disable provider
- Show/hide provider where customer-facing selection is applicable
- Configure API credentials
- Test connection
- Default courier selection
- Delivery charge settings
- Integration status
- Shipment history
- Tracking history

The Owner must be able to use:

- Pathao only
- Steadfast only
- REDX only
- Any combination
- Manual courier management
- No courier API integration at all

Do not force the business owner to activate any paid or third-party courier service.

## B. Courier Integration Features

Implement official API capabilities wherever supported:

- Delivery charge calculation
- Parcel creation
- Pickup request
- Consignment ID
- Tracking ID
- Tracking status
- Delivery status synchronization
- Cancellation
- COD information
- Shipment history

Use verified official APIs and webhooks.

Do not invent unsupported endpoints.

If a provider does not support a particular operation, clearly indicate that limitation.

## C. Manual Courier Mode

Manual courier management is mandatory.

If all courier integrations are disabled, the business owner must still be able to:

- Confirm an order
- Assign a courier manually
- Enter consignment/tracking ID
- Update shipping status
- Record courier charges
- Record COD information
- Mark delivery status
- Maintain shipment history

Courier integration must never block ordinary order processing.

## D. Courier Visibility and Selection

The Owner must control whether customers can select a delivery option during checkout.

Where courier selection is not appropriate for customer-facing checkout, keep courier assignment as an internal order-management function.

Do not expose private courier API configuration to customers.

# 18. DELIVERY CHARGES AND COD ACCOUNTING

Implement configurable delivery charges.

Support:

- Inside-city delivery
- Outside-city delivery
- District-based charges
- Area-based charges
- Custom delivery rules

Maintain separate financial records for:

- Product revenue
- Customer delivery charge
- Courier delivery fee
- COD collection
- COD settlement
- Return charges
- Refunds
- Payment gateway fees where available

Important:

An order marked Delivered must not automatically be considered financially settled.

Maintain delivery status and financial settlement status separately.

# 19. CUSTOMER ORDER TRACKING

Customer order tracking is mandatory.

Public route:

`/track/[secure-tracking-token]`

Customers must not need an account.

Show:

- Order ID
- Order date
- Products
- Quantity
- Payment method
- Order total
- Current status
- Status timeline
- Expected delivery date where known
- Courier name
- Tracking ID
- Tracking link where available

Order statuses:

- Pending
- Confirmed
- Processing
- Ready to Ship
- Shipped
- Out for Delivery
- Delivered
- Cancelled
- Returned
- Failed Delivery

Distinguish verified courier updates from manually entered updates.

Security:

- Use unpredictable tracking tokens.
- Prevent order enumeration.
- Rate-limit tracking requests.
- Never expose complete customer phone numbers or addresses publicly.
- Keep internal notes private.

# 20. CUSTOMER MANAGEMENT

Implement:

- Customer profiles
- Phone and email
- Address management
- Order history
- Total spending
- Internal notes
- Duplicate detection
- Search
- Filtering
- Customer segmentation

Protect customer information through proper permissions.

# 21. RETURNS AND REFUNDS

Implement:

- Return request
- Return reason
- Approval/rejection
- Return shipment
- Product inspection
- Restocking
- Refund recording
- Return history
- Status management

Refund processing must be integrated with payment records and actual provider refund APIs where supported.

Do not claim a refund was completed when only an internal refund record was created.

# 22. COUPON MANAGEMENT

Support:

- Percentage discount
- Fixed discount
- Product-specific coupon
- Minimum order value
- Maximum discount
- Expiry date
- Usage limits
- First-order discounts
- Enable/disable

Validate coupons server-side.

Prevent duplicate and invalid redemption.

# 23. MEDIA LIBRARY

Implement:

- Image upload
- Video upload
- Search
- Categories/folders
- Reusable assets
- Alt text
- Image optimization

Validate file size, MIME type, and actual file signature.

Use safe storage and access controls.

# 24. PRODUCT REVIEWS

Implement:

- Product ratings
- Customer reviews
- Review moderation
- Review publishing controls
- Verified purchase status only when verifiable

Never generate fake reviews or fake ratings.

# 25. ANALYTICS

Build a dashboard analytics module.

Include:

- Total products
- Published landing pages
- Page views
- Unique visitors where measurable
- CTA clicks
- Total orders
- Confirmed orders
- Delivered orders
- Cancelled orders
- Revenue
- Net revenue where calculable
- Conversion rate

Date filters:

- Today
- Yesterday
- Last 7 days
- Last 30 days
- This month
- Custom range

Define each metric accurately.

Avoid double-counting and misleading revenue calculations.

# 26. MARKETING INTEGRATIONS

Support:

- Meta Pixel
- Meta Conversions API
- Google Analytics
- Google Tag Manager

Events:

- PageView
- ViewContent
- AddToCart where applicable
- InitiateCheckout
- Purchase

Implement event deduplication where applicable.

Keep server-side credentials private.

Allow the Owner to enable/disable each integration independently.

Do not send Purchase events before the payment/order conditions required by the business configuration are met.

# 27. NOTIFICATION SYSTEM

Support:

- In-app notifications
- Email notifications
- SMS integration
- Future WhatsApp integration

Customer notifications:

- Order received
- Order confirmed
- Order shipped
- Out for delivery
- Delivered
- Cancelled

Seller notifications:

- New order
- Low stock
- Failed delivery
- Return request
- System events

Allow notification channels to be enabled/disabled independently.

Maintain notification delivery logs.

Never claim a notification was sent unless the provider confirms delivery or acceptance according to its API.

# 28. ONLINE PAYMENT AND FUTURE EXTENSIBILITY

Keep payment architecture modular.

COD must be fully functional independently.

Additional payment providers must be addable without rewriting the order management system.

Use common interfaces and provider-specific implementations.

Maintain separate payment transactions, payment attempts, refunds, and order financial states where appropriate.

# 29. OWNER DASHBOARD

Create a professional, responsive dashboard.

Main navigation:

- Overview
- Products
- Categories
- Landing Pages
- Page Builder
- Templates
- Orders
- Customers
- Inventory
- Coupons
- Reviews
- Returns & Refunds
- Analytics
- Media Library
- Staff & Permissions
- Notifications
- Marketing Integrations
- Payment Settings
- Courier & Shipping Settings
- Business Settings
- Audit Logs

The dashboard must provide complete control over the business.

This is the internal administration dashboard for one LANDIQ installation, not a SaaS platform administration panel.

# 30. DATABASE DESIGN

Use PostgreSQL and Prisma.

Design a normalized, maintainable database.

Potential entities:

- User
- Session
- Account
- VerificationToken
- BusinessSetting
- Role
- Permission
- UserRole
- Product
- ProductCategory
- ProductVariant
- ProductAttribute
- ProductImage
- Inventory
- InventoryMovement
- LandingPage
- LandingPageSection
- LandingPageTemplate
- PageVersion
- SEOSetting
- Redirect
- MediaAsset
- Customer
- CustomerAddress
- Order
- OrderItem
- OrderStatusHistory
- OrderTracking
- PaymentMethodConfiguration
- PaymentTransaction
- PaymentAttempt
- Refund
- CourierProviderConfiguration
- CourierShipment
- CourierTrackingEvent
- Coupon
- CouponRedemption
- ReturnRequest
- ProductReview
- Notification
- NotificationLog
- AnalyticsEvent
- DailyAnalyticsSummary
- Integration
- WebhookEvent
- AuditLog

This is a proposed entity list, not a requirement to create every table blindly.

Add or modify entities according to actual business logic.

Important database requirements:

- Proper foreign keys
- Unique constraints
- Indexes
- Referential integrity
- Appropriate deletion rules
- Transaction safety
- Migration history
- Data retention strategy

Payment and courier configuration must support independent provider settings.

Store sensitive credentials securely. Prefer encrypted secret storage or environment-based secrets where appropriate.

# 31. SECURITY

Security is mandatory.

Implement:

- Secure password hashing
- Secure session cookies
- Authentication and authorization
- Role-based permissions
- Rate limiting
- Brute-force protection
- Input validation
- XSS protection
- SQL injection protection
- CSRF protection where applicable
- Secure headers
- Content Security Policy
- File upload validation
- Secure secret management
- Audit logs
- Webhook verification
- Encrypted sensitive credentials
- Data privacy controls
- Backup security

Never expose:

- API secrets
- Database credentials
- Private customer data
- Internal system logs
- Sensitive configuration

# 32. USER INTERFACE AND EXPERIENCE

Build a premium, professional, modern interface.

Avoid generic AI-generated dashboard designs.

Requirements:

- Consistent design system
- Responsive dashboard
- Mobile-friendly controls
- Clear navigation
- Search and filtering
- Pagination
- Loading states
- Empty states
- Error states
- Confirmation dialogs
- Toast notifications
- Accessible components
- Consistent forms
- Useful validation messages

The marketing website should include:

- Home
- Features
- How It Works
- Demo
- Contact
- Login
- Purchase Information
- Documentation
- Privacy Policy
- Terms and Conditions

Do not add SaaS pricing plans or subscription checkout.

# 33. PERFORMANCE

Implement:

- Server-side rendering where appropriate
- Static generation where appropriate
- Optimized database queries
- Proper database indexes
- Image optimization
- Lazy loading
- Efficient caching
- Bundle optimization
- Fast public landing pages
- Core Web Vitals improvements

Never cache private customer data or authenticated dashboard responses incorrectly.

# 34. BACKUP AND RELIABILITY

Implement:

- Automated database backups
- Encrypted backups
- Retention policy
- Storage backup strategy
- Monitoring
- Error logging
- Restore documentation
- Tested restore procedure

Do not claim backup reliability without verifying restoration.

# 35. TESTING

Use:

- Vitest
- React Testing Library
- Playwright

Test important workflows:

1. Authentication
2. Role and permission enforcement
3. Product creation
4. Product variants
5. Inventory updates
6. Landing page creation
7. Landing page publishing
8. SEO metadata
9. COD order placement
10. Payment method enable/disable
11. Checkout visibility
12. Invalid payment configuration
13. Payment callback verification
14. Duplicate payment callback protection
15. Courier provider enable/disable
16. Manual courier management
17. Courier booking and tracking
18. Order tracking security
19. Inventory deduction
20. Order cancellation
21. Returns and refunds
22. Coupon validation
23. Staff permissions
24. Customer data privacy
25. Unauthorized API access

Important integration acceptance tests:

**Scenario A: COD-only business**

- Disable SSLCommerz.
- Disable bKash.
- Disable Nagad.
- Enable COD.
- Visit public checkout.
- Verify that only COD is available.
- Place a real application-level test order.
- Verify that no payment gateway API call is required.

**Scenario B: Selective payment methods**

- Enable bKash.
- Disable SSLCommerz and Nagad.
- Enable COD.
- Verify that only COD and bKash appear at checkout.
- Verify that backend order validation rejects disabled payment methods.

**Scenario C: No COD**

- Disable COD.
- Enable one properly configured online payment provider.
- Verify that COD does not appear at checkout.

**Scenario D: No courier API**

- Disable all courier integrations.
- Create an order.
- Assign a courier manually.
- Enter tracking information.
- Update delivery status.
- Verify that the order workflow remains functional.

**Scenario E: Selective courier integrations**

- Enable only one courier provider.
- Verify that its supported operations work.
- Verify that disabled providers cannot be used.

**Scenario F: Provider failure**

- Simulate a provider API failure in the test environment.
- Verify that the order is not falsely marked as paid or shipped.
- Verify error logging and safe retry behavior.

Do not mark these tests as passed unless they have actually been executed.

# 36. DEPLOYMENT

The software will be installed independently for each buyer.

Prepare:

- Production build
- Environment configuration
- Database setup
- Storage setup
- Docker configuration
- Reverse proxy configuration
- HTTPS configuration
- Deployment guide
- Backup and restore guide
- Database migration guide
- Operational documentation

Do not build shared SaaS hosting or multi-tenant domain routing.

# 37. DOCUMENTATION

Create accurate documentation:

- README.md
- ARCHITECTURE.md
- DATABASE.md
- API.md
- SECURITY.md
- DEPLOYMENT.md
- ENVIRONMENT.md
- TESTING.md
- CHANGELOG.md

Include setup, configuration, testing, deployment, backup, and recovery instructions.

# 38. IMPLEMENTATION SEQUENCE

Follow this sequence. Do not create alternative plans.

**Phase 0 — Repository Inspection**

- Inspect existing codebase.
- Identify current framework, dependencies, database, and architecture.
- Identify incomplete features.
- Prepare a concise implementation plan.

**Phase 1 — Foundation**

- Project structure
- Design system
- Database foundation
- Environment configuration

**Phase 2 — Authentication**

- Authentication
- Sessions
- RBAC
- Staff management

**Phase 3 — Dashboard**

- Dashboard layout
- Navigation
- Business settings

**Phase 4 — Product Management**

- Products
- Categories
- Variants
- Attributes
- Images

**Phase 5 — Inventory**

- Stock
- Movements
- Reservations
- Alerts

**Phase 6 — Landing Page Engine**

- Public renderer
- Dynamic product routes
- Publishing system

**Phase 7 — Page Builder**

- Section builder
- Templates
- Preview
- Editing and publishing

**Phase 8 — SEO**

- Metadata
- Sitemap
- Robots
- Structured data

**Phase 9 — Orders and COD**

- Checkout
- Order creation
- Order management
- COD accounting

**Phase 10 — Payment Integrations**

- Provider configuration
- Dashboard controls
- Checkout visibility
- SSLCommerz
- bKash
- Nagad
- Verification and transaction history

**Phase 11 — Customer Tracking**

- Secure tracking
- Status timeline
- Customer-facing tracking page

**Phase 12 — Customers and Returns**

- Customer management
- Returns
- Refund records

**Phase 13 — Courier Integrations**

- Dashboard controls
- Pathao
- Steadfast
- REDX
- Manual courier mode
- Shipment tracking

**Phase 14 — Marketing Features**

- Coupons
- Reviews
- Analytics
- Meta and Google integrations

**Phase 15 — Notifications**

- Email
- SMS
- In-app notifications

**Phase 16 — Online Payment Completion**

- Complete and verify all available payment provider integrations.
- Resolve outstanding integration issues.

**Phase 17 — Security and Testing**

- Security review
- Integration tests
- End-to-end tests
- Bug fixing

**Phase 18 — Performance and Reliability**

- Query optimization
- Image optimization
- Caching
- Backup and restore

**Phase 19 — Deployment and Documentation**

- Production build
- Deployment configuration
- Documentation
- Final verification

Do not spend unnecessary time completing optional documentation while core application features remain unimplemented.

# 39. FINAL ACCEPTANCE CRITERIA

LANDIQ is not considered complete merely because the dashboard looks finished.

The following end-to-end workflows must work:

1. Business owner can log in and configure the business.
2. Owner can create products and product variants.
3. Owner can create and publish independent landing pages.
4. Customers can visit published landing pages.
5. Customers can submit orders.
6. COD works without any payment gateway.
7. Owner can independently enable or disable SSLCommerz, bKash, and Nagad.
8. Customer checkout shows only enabled and available payment methods.
9. Owner can independently enable or disable Pathao, Steadfast, and REDX.
10. Manual courier operations work without API integrations.
11. Customers can securely track orders.
12. Delivery and COD financial settlement are tracked separately.
13. Returns and refunds can be managed.
14. Inventory updates correctly.
15. Analytics report accurate available data.
16. Permissions and customer privacy are enforced.
17. The application can be deployed independently for a business.

# 40. FINAL MISSION

Build LANDIQ as a complete, secure, professional, commercially sellable e-commerce landing page management software.

The product must give each business owner complete control over:

- Products
- Landing pages
- Orders
- Customers
- Inventory
- Payment methods
- Payment gateway integrations
- Courier integrations
- Delivery charges
- Marketing tools
- Notifications
- Analytics
- Staff permissions
- Business settings

**MOST IMPORTANT BUSINESS REQUIREMENT:**

The software must never force a business owner to pay for or activate third-party services they do not need.

A business owner must be able to run the entire basic e-commerce workflow using only COD and manual courier management.

Online payment gateways and courier API integrations are optional, independently configurable features.

Every provider must have its own configuration, activation, visibility, and status controls.

Build one complete application, one codebase, and one coherent implementation.

Do not create alternative versions.

Do not simulate functionality.

Do not claim completion without verification.

**Start by inspecting the existing repository and then implement LANDIQ.**
