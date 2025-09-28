--
-- PostgreSQL database dump
--

\restrict vWqK31o01uYg8QKSVA51pCfpTmXrfzTzwYMYqgPpg5x9b699AfoM0hT4wiglnJJ

-- Dumped from database version 14.19
-- Dumped by pg_dump version 14.19

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


-- Payment method type enum removed - payment methods now handled by gateway

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.payment_status AS ENUM (
    'PENDING',
    'AUTHORIZED',
    'SUCCEEDED',
    'FAILED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
    'CANCELLED'
);


ALTER TYPE public.payment_status OWNER TO postgres;

--
-- Name: refund_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.refund_status AS ENUM (
    'PENDING',
    'SUCCEEDED',
    'FAILED'
);


ALTER TYPE public.refund_status OWNER TO postgres;

--
-- Name: can_refund_payment(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_refund_payment(payment_uuid uuid, refund_amount integer) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    payment_amount INTEGER;
    total_refunded INTEGER;
BEGIN
    -- Get payment amount
    SELECT amount INTO payment_amount
    FROM payments 
    WHERE id = payment_uuid;
    
    -- Check if payment exists
    IF payment_amount IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Get total refunded amount
    SELECT get_total_refunded(payment_uuid) INTO total_refunded;
    
    -- Check if refund amount is valid
    RETURN (total_refunded + refund_amount) <= payment_amount;
END;
$$;


ALTER FUNCTION public.can_refund_payment(payment_uuid uuid, refund_amount integer) OWNER TO postgres;

--
-- Name: create_payment_history_entry(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_payment_history_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only create history entry if status changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO payment_history (
            payment_id, 
            status, 
            previous_status, 
            changed_by, 
            change_reason, 
            metadata
        ) VALUES (
            NEW.id,
            NEW.status,
            OLD.status,
            NULL, -- changed_by will be set by application
            'Status changed from ' || OLD.status || ' to ' || NEW.status,
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'updated_at', NEW.updated_at,
                'payment_details', jsonb_build_object(
                    'user_id', NEW.user_id,
                    'order_id', NEW.order_id,
                    'amount', NEW.amount,
                    'currency', NEW.currency,
                    'metadata', NEW.metadata,
                    'idempotency_key', NEW.idempotency_key
                ),
                'order_details', COALESCE(NEW.gateway_response->'metadata'->'order', '{}'::jsonb),
                'user_details', COALESCE(NEW.gateway_response->'metadata'->'user', '{}'::jsonb)
            )
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.create_payment_history_entry() OWNER TO postgres;

--
-- Name: get_total_refunded(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_total_refunded(payment_uuid uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    total_refunded INTEGER;
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO total_refunded
    FROM refunds 
    WHERE payment_id = payment_uuid 
    AND status = 'SUCCEEDED';
    
    RETURN total_refunded;
END;
$$;


ALTER FUNCTION public.get_total_refunded(payment_uuid uuid) OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: payment_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    payment_id uuid NOT NULL,
    status public.payment_status NOT NULL,
    previous_status public.payment_status,
    changed_by uuid,
    change_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_payment_history_reason CHECK (((change_reason IS NULL) OR (length(TRIM(BOTH FROM change_reason)) > 0)))
);


ALTER TABLE public.payment_history OWNER TO postgres;

-- Payment method types table removed - payment methods now handled by gateway


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    order_id character varying(255) NOT NULL,
    amount integer NOT NULL,
    currency character(3) NOT NULL,
    status public.payment_status DEFAULT 'PENDING'::public.payment_status NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    gateway_response jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_payments_amount CHECK ((amount > 0)),
    CONSTRAINT chk_payments_currency CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_payments_idempotency_key CHECK (((idempotency_key IS NULL) OR (length((idempotency_key)::text) > 0)))
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: TABLE payments; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.payments IS 'Main payments table storing all payment transactions';


--
-- Name: COLUMN payments.amount; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.payments.amount IS 'Amount in minor units (e.g., cents) to avoid floating point issues';


--
-- Name: COLUMN payments.gateway_response; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.payments.gateway_response IS 'Gateway response data (masked, no sensitive information)';


--
-- Name: COLUMN payments.idempotency_key; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.payments.idempotency_key IS 'Unique key for idempotent payment requests';


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refunds (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    payment_id uuid NOT NULL,
    amount integer NOT NULL,
    currency character(3) NOT NULL,
    status public.refund_status DEFAULT 'PENDING'::public.refund_status NOT NULL,
    reason text,
    idempotency_key character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_refunds_amount CHECK ((amount > 0)),
    CONSTRAINT chk_refunds_currency CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_refunds_idempotency_key CHECK (((idempotency_key IS NULL) OR (length((idempotency_key)::text) > 0))),
    CONSTRAINT chk_refunds_reason CHECK (((reason IS NULL) OR (length(TRIM(BOTH FROM reason)) > 0)))
);


ALTER TABLE public.refunds OWNER TO postgres;

--
-- Name: TABLE refunds; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.refunds IS 'Stores refund information for payments';


--
-- Name: COLUMN refunds.idempotency_key; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.refunds.idempotency_key IS 'Unique key for idempotent refund requests';


--
-- Name: payment_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.payment_summary AS
 SELECT p.id,
    p.user_id,
    p.order_id,
    p.amount,
    p.currency,
    p.status,
    p.metadata,
    p.created_at,
    p.updated_at,
    COALESCE(sum(r.amount), (0)::bigint) AS total_refunded,
        CASE
            WHEN (COALESCE(sum(r.amount), (0)::bigint) = 0) THEN 'NONE'::text
            WHEN (COALESCE(sum(r.amount), (0)::bigint) = p.amount) THEN 'FULL'::text
            ELSE 'PARTIAL'::text
        END AS refund_status
   FROM (public.payments p
     LEFT JOIN public.refunds r ON (((p.id = r.payment_id) AND (r.status = 'SUCCEEDED'::public.refund_status))))
  GROUP BY p.id, p.user_id, p.order_id, p.amount, p.currency, p.status, p.metadata, p.created_at, p.updated_at;


ALTER TABLE public.payment_summary OWNER TO postgres;

-- User payment methods table removed - payment methods now handled by gateway


--
-- Data for Name: payment_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_history (id, payment_id, status, previous_status, changed_by, change_reason, metadata, created_at) FROM stdin;
\.


-- Payment method types data removed - table no longer exists


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, user_id, order_id, amount, currency, status, metadata, gateway_response, idempotency_key, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: refunds; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.refunds (id, payment_id, amount, currency, status, reason, idempotency_key, created_at, updated_at) FROM stdin;
\.


-- User payment methods data removed - table no longer exists


--
-- Name: payment_history payment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_pkey PRIMARY KEY (id);


-- Payment method types constraints removed - table no longer exists


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


-- User payment methods constraints removed - table no longer exists


--
-- Name: idx_payment_history_changed_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_history_changed_by ON public.payment_history USING btree (changed_by) WHERE (changed_by IS NOT NULL);


--
-- Name: idx_payment_history_payment_id_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_history_payment_id_created ON public.payment_history USING btree (payment_id, created_at DESC);


--
-- Name: idx_payment_history_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_history_status ON public.payment_history USING btree (status);


-- Payment method types indexes removed - table no longer exists


--
-- Name: idx_payments_idempotency_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_payments_idempotency_key ON public.payments USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


-- Payment method ID index removed - column no longer exists


--
-- Name: idx_payments_status_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_status_created ON public.payments USING btree (status, created_at DESC);


--
-- Name: idx_payments_user_id_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_user_id_created ON public.payments USING btree (user_id, created_at DESC);


--
-- Name: idx_refunds_idempotency_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_refunds_idempotency_key ON public.refunds USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_refunds_payment_id_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refunds_payment_id_created ON public.refunds USING btree (payment_id, created_at DESC);


--
-- Name: idx_refunds_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refunds_status ON public.refunds USING btree (status);


-- User payment methods indexes removed - table no longer exists


--
-- Name: payments create_payment_history_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER create_payment_history_trigger AFTER UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.create_payment_history_entry();


-- Payment method types trigger removed - table no longer exists


--
-- Name: payments update_payments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: refunds update_refunds_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- User payment methods trigger removed - table no longer exists


--
-- Name: payment_history payment_history_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


-- Payment method foreign key constraint removed - column no longer exists


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


-- User payment methods foreign key constraints removed - table no longer exists


--
-- PostgreSQL database dump complete
--

\unrestrict vWqK31o01uYg8QKSVA51pCfpTmXrfzTzwYMYqgPpg5x9b699AfoM0hT4wiglnJJ

