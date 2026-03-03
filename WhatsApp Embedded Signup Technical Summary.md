# **Technical Architecture and Integration Strategy for Migo UIT: WhatsApp Business Onboarding via Meta Embedded Signup**

## **Strategic Overview of the Migo UIT Integration Framework**

The development of the Migo UIT Proof of Concept (POC) signifies a shift toward a more automated, user-centric onboarding model for the WhatsApp Business Platform. Traditionally, the process of onboarding a business to the WhatsApp API was a fragmented experience, involving manual coordination between Business Solution Providers (BSPs) and clients, often resulting in lead times of several days.1 Meta’s Embedded Signup Builder effectively centralizes these operations—account creation, asset linking, and phone number verification—into a single, secure OAuth-based flow that reduces the onboarding timeline to a matter of minutes.1

For a Senior Integration Engineer, the Migo UIT project must be viewed as an orchestration of several distinct Meta ecosystems: the Facebook Login for Business product, the WhatsApp Business Account (WABA) management layer, and the Cloud API messaging infrastructure.3 The objective of this report is to define the technical requirements and architectural logic necessary to implement the Embedded Signup Builder, ensuring that Migo UIT remains a scalable and secure bridge for business communications.

The transition from the on-premises API to the Cloud API, which is hosted directly by Meta, is a foundational element of this POC. This architecture eliminates the need for Migo UIT to manage local Docker containers or database instances for message processing, instead relying on the Graph API’s global infrastructure.4 By utilizing Embedded Signup, Migo UIT allows businesses to maintain direct ownership of their WABAs while granting the POC the permissions required to send and receive messages on their behalf.1

## **Administrative Prerequisites and Environmental Configuration**

Before the technical implementation of the Migo UIT POC can commence, the environment must be configured to support the high-trust interactions required by Meta. This involves establishing a verified identity for the application and ensuring all necessary assets are correctly linked within the Meta Business Suite.3

### **Meta Developer Application Setup**

The Migo UIT application must be registered as a "Business" type app within the Meta App Dashboard. This is a critical distinction, as other app types (such as "Consumer" or "Gaming") do not provide the necessary access to WhatsApp products or the Facebook Login for Business configuration ID.3

| Component | Technical Requirement | Strategic Purpose |
| :---- | :---- | :---- |
| App Type | Business | Access to WABA management and messaging APIs.3 |
| Platform | Website (HTTPS) | Required for the OAuth redirect and JavaScript SDK hosting.2 |
| App Icon | 512x512 PNG/JPG | Visible to end-users during the signup flow; must not use Meta branding.7 |
| Privacy Policy | Valid HTTPS URL | Mandatory for transitioning the app from Development to Live mode.7 |
| Category | Professional Services | Proper categorization for Meta’s automated auditing.7 |

### **The Role of Business Verification**

While the Migo UIT POC can be initially developed in a "Development" environment using tester accounts, production-grade messaging is blocked until the Meta Business Portfolio associated with the app has completed the Business Verification process.5 This process requires the submission of legal documents, such as tax registrations or business licenses, to prove the legitimacy of the entity.5 Furthermore, a phone number used in the Embedded Signup flow must not be currently registered with the standard WhatsApp or WhatsApp Business mobile applications.12 If the number is already in use, the existing account must be deleted within the mobile app's settings before it can be migrated to the Cloud API.9

## **Permissions and Scopes for the Embedded Signup Flow**

The security and functionality of the Migo UIT integration are governed by specific permission scopes requested during the OAuth handshake. These scopes define what the Migo UIT application is allowed to do within the context of the client's WABA and Business Manager.2

### **Mandatory Integration Scopes**

The Migo UIT POC requires three primary scopes to function. These must be included in the Facebook Login for Business configuration and passed during the JavaScript SDK initialization.2

1. **whatsapp\_business\_management**: This is the core management permission. It allows the Migo UIT backend to perform administrative tasks, such as fetching WABA IDs, creating or deleting message templates, and managing phone number settings.3  
2. **whatsapp\_business\_messaging**: This scope is required to initiate and respond to customer conversations via the Cloud API. Without this permission, the messaging endpoints will return a 403 Forbidden error.3  
3. **business\_management**: While more broad, this permission is often required for tech providers to link the application to the broader business portfolio of the client, facilitating the exchange of the initial code for a system-user token.2

### **Scope Tiering and Access Levels**

Meta distinguishes between "Standard Access" and "Advanced Access." During the POC phase, Standard Access is usually sufficient, as it allows the app to interact with users who have a role on the app (such as developers or testers).3 For Migo UIT to scale to general business users, it must undergo an App Review where Meta verifies the use case and grants Advanced Access.3

| Scope Name | Access Level | Implication for Migo UIT |
| :---- | :---- | :---- |
| whatsapp\_business\_management | Advanced Recommended | Needed to manage assets for non-affiliated businesses.3 |
| whatsapp\_business\_messaging | Advanced Mandatory | Required to send messages to any WhatsApp user globally.3 |
| catalog\_management | Optional | Only required if Migo UIT will manage e-commerce catalogs.14 |

## **Token Exchange Flow: From Frontend to Permanent System User Access**

A central challenge in the Migo UIT architecture is the transition from the short-lived authorization code generated on the frontend to a long-lived or permanent token on the backend. This lifecycle ensures that the business user remains in control of their assets while the application gains the persistent access required for automation.16

### **The Three-Phase Exchange Logic**

The logic is divided into three distinct phases: frontend capture, backend exchange, and system user escalation.

#### **Phase 1: Frontend Capture (The Code)**

When the business user completes the Embedded Signup flow, the Meta popup emits a message event to the Migo UIT parent window. The frontend must capture the code and the waba\_id from the event data.7

JavaScript

// Migo UIT Frontend Listener Logic  
window.addEventListener('message', (event) \=\> {  
  if (\!event.origin.endsWith('facebook.com')) return;  
  try {  
    const data \= JSON.parse(event.data);  
    if (data.type \=== 'WA\_EMBEDDED\_SIGNUP') {  
      if (data.event \=== 'FINISH' |

| data.event \=== 'FINISH\_ONLY\_WABA') {  
        const { phone\_number\_id, waba\_id } \= data.data;  
        const authCode \= data.code;   
        // Forward authCode and IDs to Migo UIT Backend  
        initiateTokenExchange(authCode, phone\_number\_id, waba\_id);  
      } else if (data.event \=== 'CANCEL') {  
        handleUserCancellation(data.data.current\_step);  
      }  
    }  
  } catch (err) {  
    console.error('Non-JSON response received', event.data);  
  }  
});

#### **Phase 2: Backend Exchange (User Access Token)**

The Migo UIT backend receives the authorization code and must perform a server-to-server request to exchange it for a "User Access Token." This token is initially short-lived (\~2 hours) but can be upgraded.2

**Endpoint:**

GET https://graph.facebook.com/\<API\_VERSION\>/oauth/access\_token

**Required Parameters:**

* client\_id: The App ID for Migo UIT.2  
* client\_secret: The App Secret for Migo UIT.2  
* code: The authorization code from Phase 1\.2

#### **Phase 3: Escalation to Permanent System User Token**

For the Migo UIT POC to operate 24/7 without manual intervention, it requires a token that does not expire. The recommended path is to create a "System User" within the Meta Business Portfolio, assign the WABA assets to that user, and generate a token for that user.9

| Token Type | Lifespan | Renewability | Migo UIT Role |
| :---- | :---- | :---- | :---- |
| Authorization Code | Single Use | \~5-10 Minutes | One-time bridge to the backend.20 |
| Short-Lived Token | \~2 Hours | Refreshable once | Testing and initial setup.8 |
| Long-Lived Token | 60 Days | Manual Refresh | Suitable for low-frequency integrations.8 |
| Permanent Token | No Expiry | Revoke only | Best for production/Migo UIT automation.16 |

## **Core API Endpoints: Payload Structures and Logic**

The Migo UIT backend interacts with the WhatsApp Business Account through a series of structured POST and GET requests.

### **Phone Number Registration**

Even after a phone number is verified during the Embedded Signup flow, it must be registered with the Cloud API to activate its messaging capabilities. This call must be made within 14 days of the initial verification.4

**Endpoint:**

POST https://graph.facebook.com/\<VERSION\>/\<PHONE\_NUMBER\_ID\>/register

**JSON Payload:**

JSON

{  
  "messaging\_product": "whatsapp",  
  "pin": "123456"  
}

Note: The pin is a 6-digit code of the developer's choice. It enables two-step verification and is mandatory for Cloud API registration.4

### **Phone Number Status Check**

Migo UIT must monitor the status of onboarded numbers to ensure they are "CONNECTED" and to track their quality rating (Green, Yellow, or Red).4

**Endpoint:**

GET https://graph.facebook.com/\<VERSION\>/\<PHONE\_NUMBER\_ID\>?fields=verified\_name,code\_verification\_status,display\_phone\_number,quality\_rating,status

**Example Response:**

JSON

{  
  "verified\_name": "Migo UIT Official",  
  "code\_verification\_status": "VERIFIED",  
  "display\_phone\_number": "+1 650-555-1234",  
  "quality\_rating": "GREEN",  
  "status": "CONNECTED",  
  "id": "1906385232743451"  
}

### **Sending a Text Message**

The messaging endpoint supports various message types, but text-based session messages are the most common for the service window.4

**Endpoint:**

POST https://graph.facebook.com/\<VERSION\>/\<PHONE\_NUMBER\_ID\>/messages

**JSON Payload:**

JSON

{  
  "messaging\_product": "whatsapp",  
  "recipient\_type": "individual",  
  "to": "14155551234",  
  "type": "text",  
  "text": {  
    "preview\_url": false,  
    "body": "Hello\! This is a message from Migo UIT."  
  }  
}

The to field must use the E.164 format (country code followed by number, no "+" or leading zeros).15

## **Webhook Architecture and Event Handling**

Webhooks are the primary mechanism for receiving real-time data from Meta. Migo UIT must provide a publicly accessible HTTPS endpoint with a valid SSL certificate to receive these events.10

### **Handshake Verification Logic**

When the Migo UIT webhook URL is first registered in the App Dashboard, Meta sends a GET request to verify the server's readiness. The server must respond with the challenge string.24

**Verification Request (GET):**

https://migo-uit.com/webhook?hub.mode=subscribe\&hub.verify\_token=MY\_SECRET\_TOKEN\&hub.challenge=1158201444

**Server Response:** The server must return the exact value of hub.challenge as the response body with a 200 OK status.10

### **Security and Validation**

To ensure the integrity of the messages, Migo UIT must validate the X-Hub-Signature-256 header. This signature is an HMAC-SHA256 hash of the payload, keyed by the App Secret.26

1. Capture the raw request body.  
2. Calculate the HMAC-SHA256 signature using the Migo UIT App Secret.  
3. Perform a constant-time comparison against the header to prevent timing attacks.26

### **JSON Structure for Standard Inbound Messages**

Incoming messages are nested within several levels of arrays (entry, changes). Migo UIT must iterate through these arrays to ensure no messages are lost during high-volume batching.26

**Webhook POST Payload:**

JSON

{  
  "object": "whatsapp\_business\_account",  
  "entry":,  
            "messages":  
          },  
          "field": "messages"  
        }  
      \]  
    }  
  \]  
}

## **Critical Operational Constraints and Rules**

The Migo UIT POC must adhere to Meta’s strict conversational guidelines, which are designed to protect users from unsolicited communications.

### **The 24-Hour Customer Service Window**

The concept of a "conversation" is defined by a 24-hour session window. The window begins either when a user sends a message or when a business sends a template message.30

* **User-Initiated (Service):** Triggered when the business responds to a user inquiry. For the next 24 hours, the business can send free-form messages.30  
* **Business-Initiated:** If the business wishes to contact a user after the window has closed (Hour 25+), it **must** use a pre-approved message template. Free-form text is blocked until the user replies.30

### **Token and Session Expiry**

* **Authorization Code Expiry:** These codes are "single-use" and expire rapidly (often within minutes). If the backend exchange fails, the user must restart the Embedded Signup flow.20  
* **Verification Certificate Validity:** Once a display name is approved, a certificate is issued. If a number is not registered with the API within 14 days of verification, the certificate expires, and the number must be re-verified.4

### **Message Tiers and Quality Ratings**

Every phone number starts at "Tier 1K," allowing it to initiate conversations with 1,000 unique customers in a rolling 24-hour period.24 If the quality rating drops to "Red" due to high user block rates or spam reports, Meta may throttle the number or disable it entirely.24

## **Implementation Checklist for Migo UIT**

This checklist outlines the sequence of operations from initial connection to functional messaging.

1. **Phase I: Environmental Setup**  
   * \[ \] Register Migo UIT as a "Business" app in Meta Developers Portal.3  
   * \[ \] Create a Facebook Login for Business configuration with whatsapp\_embedded variation.3  
   * \[ \] Whitelist the Migo UIT domain for the JavaScript SDK.2  
   * \[ \] Configure the Webhook callback URL and Verify Token in the App Dashboard.5  
2. **Phase II: Frontend Integration**  
   * \[ \] Initialize the FB SDK and implement the FB.login trigger.2  
   * \[ \] Set requested permissions to include whatsapp\_business\_management and whatsapp\_business\_messaging.3  
   * \[ \] Build the event listener to receive the code, phone\_number\_id, and waba\_id.7  
3. **Phase III: Backend Token & Asset Linkage**  
   * \[ \] Implement the POST /oauth/access\_token exchange logic.2  
   * \[ \] Create a System User and assign the WABA asset with "Full Control".9  
   * \[ \] Generate the Permanent System User token for storage in the Migo UIT database.16  
   * \[ \] Subscribe the application to the customer's WABA webhooks using the subscribed\_apps endpoint.2  
4. **Phase IV: Number Activation & Testing**  
   * \[ \] Execute the POST /register call using a 6-digit PIN to activate the number.4  
   * \[ \] Monitor number status via GET request until it reaches CONNECTED.4  
   * \[ \] Send a "Hello World" template message to a test recipient.4  
   * \[ \] Respond to an incoming message from the test recipient to verify the 24-hour window functionality.30

## **Future-Proofing the Migo UIT Architecture: The 2026 Deadline**

A critical architectural consideration for Migo UIT is the upcoming change to Meta’s Certificate Authority for mTLS webhooks. On **March 31, 2026**, Meta will transition from DigiCert to its own Certificate Authority.26 This is not merely a documentation update but a breaking infrastructure change.

Failure to add the new Meta CA certificate (meta-outbound-api-ca-2025-12.pem) to the Migo UIT server's trust store will result in TLS handshake failures.26 Without this update, Migo UIT will cease to receive any incoming messages or status updates. As a Senior Integration Engineer, it is vital to ensure that the server environment—whether hosted on AWS, Azure, or private hardware—is configured to trust this new authority well before the April 2026 cutoff.26

Furthermore, for production systems, Migo UIT should adopt a "Queue-First" architecture for webhooks. Instead of processing incoming messages synchronously, the webhook handler should immediately return an HTTP 200 OK to Meta and place the payload in a message queue (like Redis or RabbitMQ) for asynchronous processing.26 This prevents timeouts during traffic spikes and ensures that the platform remains responsive under load.

## **Conclusion**

The successful implementation of the Migo UIT POC requires a deep technical understanding of Meta’s OAuth flow and the Cloud API’s stateless messaging model. By strictly adhering to the 14-day registration window, implementing secure HMAC signature validation for webhooks, and establishing a permanent token lifecycle via System Users, Migo UIT can provide a robust and compliant onboarding experience. The integration of these components allows Migo UIT to scale from a single-user POC to a multi-tenant messaging hub while maintaining the highest standards of security and operational efficiency.

#### **Obras citadas**

1. Embedded Signup (ESU) \- Knowledge Center \- CM.com, fecha de acceso: febrero 23, 2026, [https://knowledgecenter.cm.com/knowledge-center/communications-platform/whatsapp-business/whatsapp-business-account/embedded-signup](https://knowledgecenter.cm.com/knowledge-center/communications-platform/whatsapp-business/whatsapp-business-account/embedded-signup)  
2. Embedded Signup: A Solution to Streamline Transition to WhatsApp ..., fecha de acceso: febrero 23, 2026, [https://engineering.teknasyon.com/embedded-signup-a-solution-to-streamline-transition-to-whatsapp-business-api-cdf57783a2d4](https://engineering.teknasyon.com/embedded-signup-a-solution-to-streamline-transition-to-whatsapp-business-api-cdf57783a2d4)  
3. WhatsApp Embedded Signup \- Chatwoot Developer Docs, fecha de acceso: febrero 23, 2026, [https://developers.chatwoot.com/self-hosted/configuration/features/integrations/whatsapp-embedded-signup](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/whatsapp-embedded-signup)  
4. WhatsApp Cloud API | Documentation | Postman API Network, fecha de acceso: febrero 23, 2026, [https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)  
5. Meta WhatsApp Cloud API Documentation \- Pingbix, fecha de acceso: febrero 23, 2026, [https://pingbix.com/metawhatsappcloudapidocs.html](https://pingbix.com/metawhatsappcloudapidocs.html)  
6. WhatsApp Business Cloud API: A Simplified Guide in 2026 \- Zixflow, fecha de acceso: febrero 23, 2026, [https://zixflow.com/blog/send-message-through-whatsapp-api/](https://zixflow.com/blog/send-message-through-whatsapp-api/)  
7. WhatsApp Tech Provider program integration guide \- Twilio, fecha de acceso: febrero 23, 2026, [https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)  
8. Meta \- Whatsapp Cloud API \- Configuration & Deployment Guide | Expertflow CX, fecha de acceso: febrero 23, 2026, [https://docs.expertflow.com/cx/4.5/meta-whatsapp-cloud-api-configuration-deployment-g](https://docs.expertflow.com/cx/4.5/meta-whatsapp-cloud-api-configuration-deployment-g)  
9. How to Set Up WhatsApp Cloud API Step-by-Step in Meta Developer & Business Manager, fecha de acceso: febrero 23, 2026, [https://anjoktechnologies.in/blog/how-to-set-up-whatsapp-cloud-api-step-by-step-in-meta-developer-business-manager](https://anjoktechnologies.in/blog/how-to-set-up-whatsapp-cloud-api-step-by-step-in-meta-developer-business-manager)  
10. whatsapp\_whisper/docs/whatsapp-setup-guide.md at main \- GitHub, fecha de acceso: febrero 23, 2026, [https://github.com/vierja/whatsapp\_whisper/blob/main/docs/whatsapp-setup-guide.md](https://github.com/vierja/whatsapp_whisper/blob/main/docs/whatsapp-setup-guide.md)  
11. whatsapp API Embedded signup : r/WhatsappBusinessAPI \- Reddit, fecha de acceso: febrero 23, 2026, [https://www.reddit.com/r/WhatsappBusinessAPI/comments/1ltqvk3/whatsapp\_api\_embedded\_signup/](https://www.reddit.com/r/WhatsappBusinessAPI/comments/1ltqvk3/whatsapp_api_embedded_signup/)  
12. WhatsApp Cloud API: when I text my business number I get “This number isn't on WhatsApp” how do I make it reachable? : r/webdevelopment \- Reddit, fecha de acceso: febrero 23, 2026, [https://www.reddit.com/r/webdevelopment/comments/1qyyosg/whatsapp\_cloud\_api\_when\_i\_text\_my\_business\_number/](https://www.reddit.com/r/webdevelopment/comments/1qyyosg/whatsapp_cloud_api_when_i_text_my_business_number/)  
13. Registering A New Phone Number to WhatsApp Cloud API \- bitbybit Help Center, fecha de acceso: febrero 23, 2026, [https://bitbybit.tawk.help/article/registering-a-new-phone-number-to-whatsapp-cloud-api](https://bitbybit.tawk.help/article/registering-a-new-phone-number-to-whatsapp-cloud-api)  
14. How to Generate Permanent Access token in WhatsApp Cloud API 2024 \- YouTube, fecha de acceso: febrero 23, 2026, [https://www.youtube.com/watch?v=g4BmhzK3fK8](https://www.youtube.com/watch?v=g4BmhzK3fK8)  
15. WhatsApp API Send Message: Python, PHP & Node.js Guide 2026 | Chatarmin, fecha de acceso: febrero 23, 2026, [https://chatarmin.com/en/blog/whats-app-api-send-messages](https://chatarmin.com/en/blog/whats-app-api-send-messages)  
16. WhatsApp Cloud API Permanent Access Token – Step-by-Step (System User) 2026 Complete & Correct Guide by Anjok Technologies \- Anjok Technologies, fecha de acceso: febrero 23, 2026, [https://anjoktechnologies.in/blog/-whatsapp-cloud-api-permanent-access-token-step-by-step-system-user-2026-complete-correct-guide-by-anjok-technologies](https://anjoktechnologies.in/blog/-whatsapp-cloud-api-permanent-access-token-step-by-step-system-user-2026-complete-correct-guide-by-anjok-technologies)  
17. How To Generate A Permanent Token For WhatsApp Cloud API \- Notiqoo Pro, fecha de acceso: febrero 23, 2026, [https://notiqoo.com/docs/notiqoo-pro/related-guides/how-to-generate-a-permanent-token-for-whatsapp-cloud-api/](https://notiqoo.com/docs/notiqoo-pro/related-guides/how-to-generate-a-permanent-token-for-whatsapp-cloud-api/)  
18. Question regarding Embedded Signup as Tech Provider. : r/WhatsappBusinessAPI \- Reddit, fecha de acceso: febrero 23, 2026, [https://www.reddit.com/r/WhatsappBusinessAPI/comments/1ob13xb/question\_regarding\_embedded\_signup\_as\_tech/](https://www.reddit.com/r/WhatsappBusinessAPI/comments/1ob13xb/question_regarding_embedded_signup_as_tech/)  
19. WhatsApp Embedded Signup Tutorial \- YouTube, fecha de acceso: febrero 23, 2026, [https://www.youtube.com/watch?v=zWlVkTHdP-U](https://www.youtube.com/watch?v=zWlVkTHdP-U)  
20. Magic Links Tutorial Secure Passwordless Login Made Simple \- SuperTokens, fecha de acceso: febrero 23, 2026, [https://supertokens.com/blog/magiclinks](https://supertokens.com/blog/magiclinks)  
21. Overview on Web Authentication and Authorization Protocol Security Evaluations, fecha de acceso: febrero 23, 2026, [https://elib.uni-stuttgart.de/bitstreams/4b3e0054-6a15-41c5-9693-e9542305ebd5/download](https://elib.uni-stuttgart.de/bitstreams/4b3e0054-6a15-41c5-9693-e9542305ebd5/download)  
22. WhatsApp Embedded Signup: Long-lived token expires instantly after exchange, losing my mind : r/WhatsappBusinessAPI \- Reddit, fecha de acceso: febrero 23, 2026, [https://www.reddit.com/r/WhatsappBusinessAPI/comments/1omae6d/whatsapp\_embedded\_signup\_longlived\_token\_expires/](https://www.reddit.com/r/WhatsappBusinessAPI/comments/1omae6d/whatsapp_embedded_signup_longlived_token_expires/)  
23. WhatsApp Business API Registration : r/WhatsappBusinessAPI \- Reddit, fecha de acceso: febrero 23, 2026, [https://www.reddit.com/r/WhatsappBusinessAPI/comments/1oqqjyw/whatsapp\_business\_api\_registration/](https://www.reddit.com/r/WhatsappBusinessAPI/comments/1oqqjyw/whatsapp_business_api_registration/)  
24. Guide to WhatsApp Webhooks: Features and Best Practices \- Hookdeck, fecha de acceso: febrero 23, 2026, [https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)  
25. WhatsApp Business Calling API | Voximplant Docs, fecha de acceso: febrero 23, 2026, [https://voximplant.com/docs/guides/integrations/whatsapp](https://voximplant.com/docs/guides/integrations/whatsapp)  
26. WhatsApp Webhooks: Setup, Security & Scaling (2026 Guide) \- Chatarmin, fecha de acceso: febrero 23, 2026, [https://chatarmin.com/en/blog/whatsapp-webhooks](https://chatarmin.com/en/blog/whatsapp-webhooks)  
27. Webhooks | Client Documentation, fecha de acceso: febrero 23, 2026, [https://docs.360dialog.com/docs/messaging/webhook](https://docs.360dialog.com/docs/messaging/webhook)  
28. How do I handle WhatsApp webhook authentication and validation? | CIAM Q\&A \- Your Portal for Customer Identity and Access Management Insights \- MojoAuth, fecha de acceso: febrero 23, 2026, [https://mojoauth.com/ciam-qna/how-to-handle-whatsapp-webhook-authentication-and-validation](https://mojoauth.com/ciam-qna/how-to-handle-whatsapp-webhook-authentication-and-validation)  
29. WhatsApp Webhooks \- ngrok documentation, fecha de acceso: febrero 23, 2026, [https://ngrok.com/docs/integrations/webhooks/whatsapp-webhooks](https://ngrok.com/docs/integrations/webhooks/whatsapp-webhooks)  
30. What is the WhatsApp 24-hour rule? \- Sprout Help Center, fecha de acceso: febrero 23, 2026, [https://support.sproutsocial.com/hc/en-us/articles/5343786902669-What-is-the-WhatsApp-24-hour-rule](https://support.sproutsocial.com/hc/en-us/articles/5343786902669-What-is-the-WhatsApp-24-hour-rule)  
31. WhatsApp Conversation Guidelines \- JustCall Help Center, fecha de acceso: febrero 23, 2026, [https://help.justcall.io/en/articles/8915730-whatsapp-conversation-guidelines](https://help.justcall.io/en/articles/8915730-whatsapp-conversation-guidelines)  
32. WhatsApp Business Platform 24 Hour Rule \- Enchant, fecha de acceso: febrero 23, 2026, [https://www.enchant.com/whatsapp-business-platform-24-hour-rule](https://www.enchant.com/whatsapp-business-platform-24-hour-rule)  
33. What is the 24 hour rule for WhatsApp Business? \- Vizologi, fecha de acceso: febrero 23, 2026, [https://vizologi.com/what-is-hour-rule-for-whatsapp-business/](https://vizologi.com/what-is-hour-rule-for-whatsapp-business/)  
34. WhatsApp 24-Hour Rule: Why Professional Firms are Switching \- Qwil Messenger, fecha de acceso: febrero 23, 2026, [https://www.qwilmessenger.com/blog/whatsapp-24-hour-window](https://www.qwilmessenger.com/blog/whatsapp-24-hour-window)  
35. Public API for WhatsApp Cloud Integration \- WOZTELL, fecha de acceso: febrero 23, 2026, [https://support.woztell.com/portal/en/kb/articles/public-api](https://support.woztell.com/portal/en/kb/articles/public-api)